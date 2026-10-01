import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// A reviewed stamp pins both runtime and guest-task code before any VM starts.
const args = process.argv.slice(2);
assert.ok([3, 5, 7].includes(args.length),
  'Use node --import tsx scripts/smoke-runtime-project-identity.ts <distro> <stopped-owned-fixture> <freeze-json> [--install-python <official-version>] [--install-node 22.12.0].');
const [distro, fixture, stampFile] = args;
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const installOptions: Record<string, string> = {};
for (let i = 3; i < args.length; i += 2) {
  assert.ok(['--install-python', '--install-node'].includes(args[i]));
  assert.equal(installOptions[args[i]], undefined, 'Duplicate installation option.');
  assert.match(args[i + 1], /^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
  installOptions[args[i]] = args[i + 1];
}
const installPython = installOptions['--install-python'], installNode = installOptions['--install-node'];
if (installPython) assert.equal(installPython, '3.12.12', 'This smoke pins the reviewed uv download metadata.');
if (installNode) {
  assert.ok(['debian', 'ubuntu'].includes(distro), 'Official Node archives require the tested glibc guests.');
  assert.equal(installNode, '22.12.0', 'This smoke pins the reviewed official Node release.');
}
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data', 'network-remaining-test-temp'));
const root = await realpath(resolve(fixture));
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const freezeFile = await realpath(resolve(stampFile));
assert.ok(freezeFile.startsWith(parent + sep));
const freezeBytes = await readFile(freezeFile), freeze = JSON.parse(freezeBytes.toString());
assert.equal(freeze.version, 1);
assert.equal(freeze.frozen, true, 'Wait for both runtime and guest-task owners to freeze.');
const digest = (input: Buffer | string) => createHash('sha256').update(input).digest('hex');
const requiredSources = ['server/runtime-versions.ts', 'server/runtime-probe.ts', 'server/runtime-config.ts',
  'server/runtime-install.ts', 'server/workspaces.ts',
  'server/guest-task.ts', 'server/project-run-scope.ts', 'server/project-identity.ts', 'server/project-main.ts',
  'server/project-services.ts', 'server/project-service-scope.ts', 'server/project-directory-migration.ts',
  'server/project-terminals.ts', 'server/jobs.ts', 'plugins/runtimes/server.ts',
  'native/project-identity/controller.py', 'native/project-identity/launcher.c', 'native/project-identity/protocol.h'];
for (const source of requiredSources) assert.match(freeze.sourceSha256?.[source] || '', /^[a-f0-9]{64}$/);
for (const [source, expected] of Object.entries(freeze.sourceSha256) as [string, string][]) {
  assert.ok(/^(server|plugins|native)\/[A-Za-z0-9/_.-]+$/.test(source));
  assert.ok(source.split('/').every(part => part && !['.', '..'].includes(part)));
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(digest(await readFile(join(workspace, source))), expected, 'Source is not frozen: ' + source);
}
const oldFiles: { file: string; sha256: string }[] = [];
let prior: any;
for (const summaryName of ['project-uid-scopes-final-summary.json', 'project-uid-migration-overlap-final-summary.json']) {
  const file = join(parent, summaryName), bytes = await readFile(file), summary = JSON.parse(bytes.toString());
  assert.equal(summary.status, 'passed');
  oldFiles.push({ file, sha256: digest(bytes) });
  for (const entry of summary.proofs) {
    const proofFile = await realpath(entry.file), proofBytes = await readFile(proofFile);
    assert.equal(dirname(dirname(proofFile)), parent);
    assert.equal(digest(proofBytes), entry.fileSha256);
    oldFiles.push({ file: proofFile, sha256: digest(proofBytes) });
    const evidence = JSON.parse(proofBytes.toString());
    assert.equal(evidence.vmStopped, true); assert.equal(evidence.liveEntries, 0);
    assert.equal(evidence.error, undefined);
    if (summaryName === 'project-uid-scopes-final-summary.json' && entry.distro === distro) prior = evidence;
  }
}
assert.ok(prior); assert.equal(prior.fixture, root);
const previousGuest = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
assert.equal(previousGuest.vmId, prior.vmId); assert.equal(previousGuest.distro, distro);
assert.equal(previousGuest.vmStopped, true); assert.equal(previousGuest.error, undefined);
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, prior.vmId);
assert.equal(records[0].distro, distro); assert.equal(records[0].name, 'guest-task-cgroup-smoke');
assert.equal(records[0].bootstrapped, true);
for (const key of ['sandbox', 'storagePoolId', 'haPromotion', 'haRetirement', 'lastError']) assert.equal(records[0][key], undefined);
const vmId: string = prior.vmId, machineDirectory = await realpath(join(root, 'machines', vmId));
assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
assert.equal(dirname(await realpath(join(machineDirectory, 'disk.qcow2'))), machineDirectory);
const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$r='" + root.replaceAll("'", "''") + "';$v='" + vmId + "';@(" +
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) }).Count"
], { encoding: 'utf8' }).trim());
assert.equal(exactQemu(), 0);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images',
  { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]!);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { RuntimeVersions, runtimeBin } = await import('../server/runtime-versions.ts');
const { runtimeInstallCommand, parseRuntimeInstall } = await import('../server/runtime-install.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
const { guestTaskControlPaths, guestTaskControlRoot } = await import('../server/guest-task.ts');
const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
const { ProjectMainScope } = await import('../server/project-service-scope.ts');
const { route: runtimeRoute } = await import('../plugins/runtimes/server.ts');
const { quote } = await import('../server/files.ts');
type RuntimeView = { selected: Record<string, string>; declared: Record<string, string>; actual: { node: string; python: string };
  probe: { state: string; checkedAt: string | null; configVersion: string | null; bootId: string | null; errorCode?: string } };
type RuntimeApi = { view(id: string, signal?: AbortSignal): Promise<RuntimeView>;
  probe(id: string, signal?: AbortSignal): Promise<RuntimeView>;
  select(id: string, input: unknown, signal?: AbortSignal): Promise<unknown>; install(id: string, input: unknown): Promise<any>;
  jobs: any; close(): Promise<unknown> };
const invocation = randomUUID(), payloadCanary = 'runtime-project-body-' + invocation;
const pythonOfficialSource = {
  uvVersion: '0.10.11', version: '3.12.12', build: '20260211',
  metadata: 'https://raw.githubusercontent.com/astral-sh/uv/0.10.11/crates/uv-python/download-metadata.json',
  assets: {
    gnu: { key: 'cpython-3.12.12-linux-x86_64-gnu',
      url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260211/cpython-3.12.12%2B20260211-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
      sha256: '1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c' },
    musl: { key: 'cpython-3.12.12-linux-x86_64-musl',
      url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260211/cpython-3.12.12%2B20260211-x86_64-unknown-linux-musl-install_only_stripped.tar.gz',
      sha256: 'd12d5af7c1cae4cdb69d3b98ae9151dcb9c57d0444f5217b7ba0a6f6e4e84441' }
  },
  attribution: 'Official uv tag metadata verified before execution; this declaration alone is not an installation result.'
};
const scriptFile = join(workspace, 'scripts', 'smoke-runtime-project-identity.ts');
const proofFile = join(root, 'runtime-project-identity-evidence-' + invocation + '.json');
const packagedIdentity = await projectIdentitySources();
for (const [name, bytes] of packagedIdentity.files)
  assert.equal(digest(bytes), freeze.sourceSha256['native/project-identity/' + name], 'Packaged identity bytes differ from the reviewed source.');
const qemuExecutions: any[] = [];
const proof: any = { version: 1, fixture: root, vmId, distro, invocation, passed: false, phase: 'initializing',
  scope: 'Runtime UID probing, host-only GET cache, strict declarations/output, cancellation and CAS; official installation only if explicitly requested.',
  client: { node: process.version, pid: process.pid, execArgv: process.execArgv,
    noAddonsRequested: process.execArgv.includes('--no-addons') },
  startedAt: new Date().toISOString(), frozenStamp: { file: freezeFile, sha256: digest(freezeBytes) },
  sourceSha256: freeze.sourceSha256, scriptSha256: digest(await readFile(scriptFile)), cases: [], qemuExecutions,
  packagedIdentityManifest: packagedIdentity.manifest,
  previousEvidence: { files: oldFiles, attribution: 'Original 54 and 9 source hashes retained without relabelling.' },
  officialInstallRequested: { python: installPython || null, node: installNode || null },
  pythonOfficialSource: installPython ? pythonOfficialSource : null,
  nodeOfficialRelease: installNode ? 'https://nodejs.org/en/blog/release/v22.12.0' : null };
await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
const runtime = await createRuntime(), nativeRuntimeRun = runtime.run.bind(runtime);
runtime.run = (async (...call: Parameters<typeof nativeRuntimeRun>) => {
  if (call[0] !== 'sakura-qemu' || !call[1].some(value => value.includes(root))) return nativeRuntimeRun(...call);
  const item = { startedAt: new Date().toISOString(), settled: false, argvSha256: digest(JSON.stringify(call[1])) };
  qemuExecutions.push(item);
  try { return await nativeRuntimeRun(...call); }
  finally { item.settled = true; Object.assign(item, { endedAt: new Date().toISOString() }); }
}) as typeof runtime.run;
const machines = new Machines(runtime); await machines.init();
assert.equal(machines.records.size, 1); assert.equal(machines.state(vmId), 'stopped'); assert.equal(machines.live.size, 0);
const spaces = new Workspaces(machines), core = new ProjectIdentities(machines), scopes = new ProjectRunScopes(machines);
const versions = new RuntimeVersions(machines, spaces) as unknown as RuntimeApi;
assert.equal(typeof versions.probe, 'function');
const migrations = new ProjectDirectoryMigrations(machines, spaces);
const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines), nativeConnect = machines.connect.bind(machines);
const nativeRead = machines.readGuestFile.bind(machines), nativeWrite = machines.writeGuestFile.bind(machines);
const nativeSave = spaces.save.bind(spaces);
const io = { exec: 0, execInput: 0, connect: 0, read: 0, write: 0 }, commands: string[] = [];
machines.exec = (async (...call) => { io.exec++; commands.push(call[1]); return nativeExec(...call); }) as typeof machines.exec;
machines.execInput = (async (...call) => { io.execInput++; commands.push(call[1]); return nativeInput(...call); }) as typeof machines.execInput;
machines.connect = (async (...call) => { io.connect++; return nativeConnect(...call); }) as typeof machines.connect;
machines.readGuestFile = (async (...call) => { io.read++; return nativeRead(...call); }) as typeof machines.readGuestFile;
machines.writeGuestFile = (async (...call) => { io.write++; return nativeWrite(...call); }) as typeof machines.writeGuestFile;
const fixed = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ';
const python = (body: string) => '/usr/bin/python3 -I -S -c ' + quote(body);
const run = async (body: string, timeout = 30000) => {
  const result = await nativeExec(vmId, body, timeout); assert.equal(result.code, 0, result.stdout + result.stderr); return result.stdout.trim();
};
const guestPython = async (body: string) => run(fixed + python(body));
const check = async (name: string, action: () => Promise<unknown>) => {
  const startedAt = new Date().toISOString();
  proof.activeCase = { name, startedAt };
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  try {
    const evidence = await action();
    proof.cases.push({ name, startedAt, finishedAt: new Date().toISOString(), evidence });
    delete proof.activeCase;
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
    console.log('PASS ' + distro + ' ' + name);
  } catch (error) {
    proof.failedCase = { name, startedAt, failedAt: new Date().toISOString(), error: String(error) };
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
    throw error;
  }
};
const originalCatalog = await spaces.projects.list(vmId);
assert.ok(originalCatalog.projects.length <= 18);
const preservedHostFiles = [...oldFiles];
for (const entry of originalCatalog.projects) {
  const path = spaces.projects.inScope(vmId, entry.id, () => spaces.projects.file(vmId));
  try { preservedHostFiles.push({ file: path, sha256: digest(await readFile(path)) }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const originalJournalDir = join(machineDirectory, 'project-identities');
for (const name of await readdir(originalJournalDir)) if (/^(default|[a-f0-9]{16})\.json$/.test(name)) {
  const file = join(originalJournalDir, name); preservedHostFiles.push({ file, sha256: digest(await readFile(file)) });
}
const oldIdentities: Record<string, any> = {};
let oldAccounts: unknown;
const probeDir = '/workspace/sakura-runtime-probe-' + invocation, neighborDir = '/workspace/sakura-runtime-neighbor-' + invocation;
const rootOnlyDir = '/tmp/sakura-owned-runtime-root-' + invocation;
let probeId: string | undefined, neighborId: string | undefined, probeProject: any, neighborProject: any, identity: any, neighborIdentity: any;
let neighborProcess: any, httpBase = '', latestReport: any;
const inProbe = async <T>(action: () => Promise<T>) => spaces.projects.inScope(vmId, probeId!, action);
const inNeighbor = async <T>(action: () => Promise<T>) => spaces.projects.inScope(vmId, neighborId!, action);
const task = async (project: any, code: string) => {
  const result = await projectIdentityTask(machines, vmId, project, { command: python(code), environment: project.environment },
    new AbortController().signal, undefined, 60000);
  assert.equal(result.code, 0, result.stdout + result.stderr); return result.stdout.trim();
};
const journal = async (id = probeId!) => JSON.parse(await readFile(join(machineDirectory, 'project-identities', id + '.json'), 'utf8'));
const assertClosed = async (id = probeId!) => {
  await scopes.guard(vmId, id);
  const value = await journal(id);
  for (const entry of value.runs) { assert.equal(entry.phase, 'closed'); if (entry.run) assert.equal(entry.run.phase, 'closed'); }
  const directories = value.runs.filter((entry: any) => entry.owner.kind === 'task')
    .map((entry: any) => guestTaskControlPaths(entry.runId).directory);
  await guestPython('import os,stat\np=' + JSON.stringify(guestTaskControlRoot) +
    '\ni=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and i.st_gid==0 and stat.S_IMODE(i.st_mode)==0o700\n' +
    'for p in ' + JSON.stringify(directories) + ':\n assert not os.path.lexists(p)');
  return { runs: value.runs.length, allClosed: true, taskControlRoot: guestTaskControlRoot,
    taskControlDirectoriesRetired: directories.length };
};
const readOwnedJson = async (path: string, expectedUid: number) => JSON.parse(await guestPython(
  'import json,os,stat\np=' + JSON.stringify(path) + ';f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n' +
  'assert stat.S_ISREG(i.st_mode) and i.st_uid==' + expectedUid + ' and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600 and i.st_size<16384\n' +
  "data=os.read(f,16385);os.close(f);print(data.decode('utf-8','strict'))"
));
const alive = async (child: any) => JSON.parse(await guestPython(
  'import json\ntry:\n f=open("/proc/' + child.pid + '/stat").read().rsplit(") ",1)[1].split();v=f[0] not in ("Z","X") and f[19]==' + JSON.stringify(child.ticks) +
  '\nexcept FileNotFoundError:v=False\nprint(json.dumps(v))'
));
const preserveNeighbor = async () => {
  if (neighborProcess) {
    assert.equal(await alive(neighborProcess), true);
    assert.equal((await inNeighbor(() => new ProjectMainScope(machines, vmId, neighborProject).status())).status, 'running');
  }
};
const guestTickets = async () => JSON.parse(await guestPython(
  "import hashlib,json,os,stat\np='/run/sakura-project-identities/runs';result={}\nif os.path.isdir(p):\n for name in sorted(os.listdir(p)):\n  f=os.open(p+'/'+name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1\n  b=os.read(f,16385);os.close(f);assert len(b)<=16384;result[name]=hashlib.sha256(b).hexdigest()\nprint(json.dumps(result))"
));
const fakeNodeBody = [
  '#!/usr/bin/python3', 'import json,os,signal,time',
  'BASE=' + JSON.stringify(probeDir), 'ROOT=' + JSON.stringify(rootOnlyDir),
  'CANARY=' + JSON.stringify(payloadCanary),
  'mode=open(BASE+"/mode").read().strip()', 'signal.signal(signal.SIGTERM,signal.SIG_IGN)',
  'def publish(name):',
  ' status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)',
  ' fields=open("/proc/self/stat").read().rsplit(") ",1)[1].split()',
  ' denied=False',
  ' try:open(ROOT+"/forbidden-write","w").write("root-bug")',
  ' except PermissionError:denied=True',
  ' value={"name":name,"uid":os.getuid(),"euid":os.geteuid(),"gid":os.getgid(),"pid":os.getpid(),"pgid":os.getpgrp(),"sid":os.getsid(0),"ticks":fields[19],"home":os.environ.get("HOME"),"cwd":os.getcwd(),"path":os.environ.get("PATH"),"networkInode":str(os.stat("/proc/self/ns/net").st_ino),"cgroup":open("/proc/self/cgroup").read().strip(),"noNewPrivs":status["NoNewPrivs"].strip(),"caps":{key:status[key].strip() for key in ("CapInh","CapPrm","CapEff","CapBnd","CapAmb")},"rootWriteDenied":denied,"bodyCanary":os.environ.get("RUNTIME_BODY")==CANARY}',
  ' f=os.open(BASE+"/report-"+name+".json",os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)',
  ' try:os.write(f,json.dumps(value).encode())',
  ' finally:os.close(f)',
  ' return value',
  'publish("main")',
  'if mode=="loop":',
  ' for name in ("newgroup","setsid","doublefork"):',
  '  first=os.fork()',
  '  if first==0:',
  '   if name=="newgroup":os.setpgid(0,0)',
  '   else:os.setsid()',
  '   if name=="doublefork":',
  '    if os.fork()!=0:os._exit(0)',
  '   publish(name)',
  '   while True:time.sleep(1)',
  '  if name=="doublefork":os.waitpid(first,0)',
  ' while True:time.sleep(1)',
  'elif mode=="limit":os.write(1,b"x"*8193)',
  'elif mode=="stderr-limit":os.write(2,b"x"*8193)',
  'elif mode=="suffix":os.write(1,b"v99.31.41-injected\\n")',
  'elif mode=="nul":os.write(1,b"v99.31.41\\x00\\n")',
  'elif mode=="invalid-utf8":os.write(1,b"v99.31.41\\xff\\n")',
  'else:os.write(1,b"v99.31.41\\n")', ''
].join('\n');
const setMode = async (mode: string) => task(probeProject,
  'import os\np=' + JSON.stringify(probeDir) + '\nopen(p+"/mode","w").write(' + JSON.stringify(mode) + ')\n' +
  'for name in ("main","newgroup","setsid","doublefork"):\n try:os.unlink(p+"/report-"+name+".json")\n except FileNotFoundError:pass'
);
const getReport = async () => {
  latestReport = await readOwnedJson(probeDir + '/report-main.json', identity.uid); return latestReport;
};
const getLiveReports = async () => JSON.parse(await guestPython(
  'import json,os,stat\nresult=[]\n' +
  'for name in ("main","newgroup","setsid","doublefork"):\n' +
  ' p=' + JSON.stringify(probeDir + '/report-') + '+name+".json"\n' +
  ' try:f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)\n' +
  ' except FileNotFoundError:result=None;break\n' +
  ' try:\n  i=os.fstat(f);assert stat.S_ISREG(i.st_mode) and i.st_uid==' + (identity?.uid || 0) +
  ' and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600 and i.st_size<16384\n' +
  '  if i.st_size==0:result=None;break\n  value=json.loads(os.read(f,16385))\n' +
  ' finally:os.close(f)\n' +
  ' fields=open("/proc/"+str(value["pid"])+"/stat").read().rsplit(") ",1)[1].split()\n' +
  ' value["observedAlive"]=fields[0] not in ("Z","X") and fields[19]==value["ticks"]\n result.append(value)\n' +
  'print(json.dumps(result))'
));
const accountSnapshot = async () => JSON.parse(await guestPython(
  'import grp,json,os,pwd,stat\nresult={}\nidentities=' + JSON.stringify(Object.values(oldIdentities)) +
  '\nfor identity in identities:\n' +
  ' name=identity["account"];entry={}\n' +
  ' try:\n  p=pwd.getpwnam(name);entry["user"]={"name":p.pw_name,"uid":p.pw_uid,"gid":p.pw_gid,"home":p.pw_dir,"shell":p.pw_shell}\n' +
  ' except KeyError:entry["user"]=None\n' +
  ' try:\n  g=grp.getgrgid(identity["gid"]);entry["group"]={"name":g.gr_name,"gid":g.gr_gid,"members":g.gr_mem}\n' +
  ' except KeyError:entry["group"]=None\n' +
  ' try:\n  h=os.lstat(identity["home"]);entry["home"]={"device":str(h.st_dev),"inode":str(h.st_ino),"uid":h.st_uid,"gid":h.st_gid,"mode":stat.S_IMODE(h.st_mode),"directory":stat.S_ISDIR(h.st_mode)}\n' +
  ' except FileNotFoundError:entry["home"]=None\n result[name]=entry\nprint(json.dumps(result))'
));
const failProbe = async (expectedCode: string) => {
  const started = Date.now(), abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20_000);
  let code: string | undefined;
  try { await inProbe(() => versions.probe(vmId, abort.signal)); }
  catch (error) { code = (error as { code?: string }).code; if (!code) throw error; }
  finally { clearTimeout(timer); }
  assert.equal(code, expectedCode); assert.ok(Date.now() - started < 25_000);
  const view = await inProbe(() => versions.view(vmId));
  assert.equal(view.probe.state, 'failed'); assert.equal(view.probe.errorCode, expectedCode);
  await preserveNeighbor();
  return { code, elapsedMs: Date.now() - started, cleanup: await assertClosed() };
};
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  try {
    const handled = await inProbe(() => runtimeRoute.call({ machines, runtimes: versions } as any, req, res,
      new URL(req.url || '/', httpBase), async request => {
        let text = ''; for await (const piece of request) text += piece.toString(); return JSON.parse(text || '{}');
      }, controller.signal));
    if (!handled) { res.writeHead(404); res.end(); }
  } catch (error) {
    res.writeHead((error as { status?: number }).status || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (error as Error).message, code: (error as { code?: string }).code }));
  }
});
const getStorm = async (count: number, expectedState: string) => {
  const tickets = await guestTickets(), bytes = await readFile(join(originalJournalDir, probeId! + '.json'));
  const before = { ...io };
  for (let start = 0; start < count; start += 20) {
    await Promise.all(Array.from({ length: Math.min(20, count - start) }, async () => {
      const response = await fetch(httpBase + '/api/vms/' + vmId + '/runtimes');
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const value = await response.json() as RuntimeView;
      assert.equal(value.probe.state, expectedState);
      assert.equal(JSON.stringify(value).includes(payloadCanary), false);
    }));
  }
  assert.deepEqual(io, before, 'A GET performed guest execution/connection/installation or guest file I/O.');
  assert.equal(digest(await readFile(join(originalJournalDir, probeId! + '.json'))), digest(bytes));
  assert.deepEqual(await guestTickets(), tickets);
  return { requests: count, state: expectedState, guestCalls: 0, hostRunJournalUnchanged: true,
    nativeTicketFilesUnchanged: true, note: 'Cache only; not the separate 1024-ticket archive boundary.' };
};
const installOfficial = async (tool: 'node' | 'python', version: string) => {
  const architecture = records[0].architecture || 'x86_64';
  const receiptPath = '/var/lib/sakura/runtime-versions/' + tool + '-' + version + '.json';
  // Only inspect the two fixed legacy metadata objects. The new installer must
  // neither scan nor repair this shared tree, including the retained 0666 lock.
  const legacyMetadata = () => guestPython('import json,os,stat\nresult={}\n' +
    'for path in ["/opt/sakura-runtimes/python-downloads","/opt/sakura-runtimes/python-downloads/.lock"]:\n' +
    ' try:\n  item=os.lstat(path);result[path]={"device":str(item.st_dev),"inode":str(item.st_ino),"uid":item.st_uid,"gid":item.st_gid,"mode":stat.S_IMODE(item.st_mode),"regular":stat.S_ISREG(item.st_mode),"directory":stat.S_ISDIR(item.st_mode),"links":item.st_nlink}\n' +
    ' except FileNotFoundError:result[path]=None\nprint(json.dumps(result))');
  const legacyBefore = tool === 'python' ? JSON.parse(await legacyMetadata()) : null;
  const taskScopes = async () => JSON.parse(await guestPython('import json,os,re\n' +
    'names=[name for name in os.listdir("/sys/fs/cgroup") if re.fullmatch(r"sakura-task-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}",name)]\n' +
    'assert len(names)<=128\nprint(json.dumps(sorted(names)))')) as string[];
  const taskScopesBefore = await taskScopes();
  const preexisting = JSON.parse(await guestPython('import json,os\nprint(json.dumps(os.path.lexists(' + JSON.stringify(receiptPath) + ')))'));
  if (preexisting) {
    const checked = await nativeExec(vmId, runtimeInstallCommand({ operation: 'verify', tool, version, architecture }), 30000);
    parseRuntimeInstall(checked, { tool, version, phase: 'ready', architecture });
  }
  const attempt: any = { tool, version, architecture, preexistingReadyArtifact: preexisting,
    startedAt: new Date().toISOString(), legacySharedMetadata: legacyBefore,
    boundary: 'Real administrator download/install; project verification follows only a ready receipt.' };
  (proof.installAttempts ||= []).push(attempt);
  const job = await inProbe(() => versions.install(vmId, { tool, version }));
  attempt.jobId = job.id;
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  await versions.jobs.wait(vmId + ':' + probeId);
  Object.assign(attempt, { status: job.status, error: job.error || null, errorCode: job.errorCode || null,
    logSha256: digest(job.log || ''), finalLog: (job.log || '').slice(-8192), jobFinishedAt: new Date().toISOString() });
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  assert.equal(job.status, 'done', job.error + '\n' + job.log);
  const taskScopesAfter = await taskScopes();
  assert.deepEqual(taskScopesAfter, taskScopesBefore, 'The current install API left a new task scope, including when reusing an older ready receipt.');
  attempt.currentApiTaskScopes = { before: taskScopesBefore, after: taskScopesAfter };
  const checked = await nativeExec(vmId, runtimeInstallCommand({ operation: 'verify', tool, version, architecture }), 30000);
  const receipt = parseRuntimeInstall(checked, { tool, version, phase: 'ready', architecture });
  const full = await readOwnedJson(receiptPath, 0);
  assert.equal(full.installId, receipt.installId); assert.equal(full.phase, 'ready');
  assert.equal(full.tool, tool); assert.equal(full.requestedVersion, version); assert.equal(full.architecture, architecture);
  assert.equal(full.stage, '/opt/sakura-runtimes/.install-' + receipt.installId);
  const managedPath = tool === 'python' ? '/opt/sakura-runtimes/python-managed-' + receipt.installId : null;
  assert.equal(full.managedPath, managedPath);
  let managedMetadata: any = null;
  if (tool === 'python') {
    assert.ok(full.managedInfo && typeof full.managedInfo === 'object');
    assert.deepEqual(Object.keys(full.managedInfo).sort(), ['device', 'inode']);
    for (const value of Object.values(full.managedInfo)) assert.match(String(value), /^[1-9][0-9]*$/);
    managedMetadata = JSON.parse(await guestPython('import json,os,stat\np=' + JSON.stringify(managedPath) +
      '\nf=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\ntry:i=os.fstat(f)\nfinally:os.close(f)\n' +
      'assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o755\n' +
      'print(json.dumps({"device":str(i.st_dev),"inode":str(i.st_ino),"uid":i.st_uid,"gid":i.st_gid,"mode":stat.S_IMODE(i.st_mode)}))'));
    assert.equal(managedMetadata.device, full.managedInfo.device); assert.equal(managedMetadata.inode, full.managedInfo.inode);
    assert.deepEqual(JSON.parse(await legacyMetadata()), legacyBefore);
  } else assert.equal(full.managedInfo, null);
  assert.match(full.scope.name, /^sakura-task-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  if (!preexisting) assert.equal(full.scope.bootId, proof.bootId);
  await guestPython('import os\nassert not os.path.lexists(' + JSON.stringify(full.stage) + ')\n' +
    'assert not os.path.lexists(' + JSON.stringify('/sys/fs/cgroup/' + full.scope.name) + ')');
  attempt.readyReceipt = { receipt, stage: full.stage, scope: full.scope,
    managedPath: full.managedPath, managedInfo: full.managedInfo, managedMetadata };
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  const originalPins = probeProject.runtimes || {};
  await inProbe(() => versions.select(vmId, { ...originalPins, [tool]: version }));
  probeProject = await inProbe(() => spaces.config(vmId));
  const view = await inProbe(() => versions.probe(vmId));
  assert.equal(view.actual[tool], version);
  assert.equal(view.selected[tool], version);
  const resolved = await spaces.resolveProject(vmId, probeProject);
  const selectedEnvironment = resolved.environment; assert.ok(selectedEnvironment);
  const binary = runtimeBin(tool, version) + '/' + (tool === 'node' ? 'node' : 'python3');
  let command: string;
  if (tool === 'python') {
    const body = [
      'import json,os,stat,subprocess,sys',
      'import shutil',
      'status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)',
      'binary=' + JSON.stringify(binary), 'metadata=os.stat(sys.executable)',
      'managed=' + JSON.stringify(managedPath) + ';managedMetadata=os.lstat(managed)',
      'assert stat.S_ISDIR(managedMetadata.st_mode) and managedMetadata.st_uid==0 and stat.S_IMODE(managedMetadata.st_mode)==0o755 and os.access(managed,os.R_OK|os.X_OK)',
      'alias=subprocess.run([' + JSON.stringify(runtimeBin(tool, version) + '/python') + ',"-I","-S","-c","import sys;print(sys.version.split()[0])"],capture_output=True,timeout=10)',
      'assert alias.returncode==0 and alias.stderr==b"" and len(alias.stdout)<=4096,json.dumps({"tool":"alias-python","code":alias.returncode,"stdout":alias.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":alias.stderr[:4096].decode("utf-8","backslashreplace")})',
      'pip=subprocess.run([' + JSON.stringify(runtimeBin(tool, version) + '/pip') + ',"--version"],capture_output=True,timeout=10)',
      'assert pip.returncode==0 and pip.stderr==b"" and len(pip.stdout)<=4096,json.dumps({"tool":"pip-version","code":pip.returncode,"stdout":pip.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":pip.stderr[:4096].decode("utf-8","backslashreplace")})',
      'realpath=shutil.which("realpath");assert realpath;realpathMetadata=os.stat(realpath)',
      'resolvedPip=subprocess.run([realpath,"--",' + JSON.stringify(runtimeBin(tool, version) + '/pip') + '],capture_output=True,timeout=10)',
      'assert resolvedPip.returncode==0 and resolvedPip.stderr==b"" and len(resolvedPip.stdout)<=4096,json.dumps({"tool":"realpath-pip","code":resolvedPip.returncode,"stdout":resolvedPip.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":resolvedPip.stderr[:4096].decode("utf-8","backslashreplace")})',
      'realpathVersion=subprocess.run([realpath,"--version"],capture_output=True,timeout=10)',
      'assert realpathVersion.returncode==0 and realpathVersion.stderr==b"" and len(realpathVersion.stdout)<=4096',
      'packages=subprocess.run([' + JSON.stringify(runtimeBin(tool, version) + '/pip') + ',"list","--format=json","--disable-pip-version-check"],capture_output=True,timeout=10)',
      'assert packages.returncode==0 and packages.stderr==b"" and len(packages.stdout)<=16384,json.dumps({"tool":"pip-list","code":packages.returncode,"stdout":packages.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":packages.stderr[:4096].decode("utf-8","backslashreplace")})',
      'venv=' + JSON.stringify(probeDir + '/venv-relocation-check'),
      'created=subprocess.run([binary,"-I","-m","venv","--without-pip",venv],capture_output=True,timeout=20)',
      'assert created.returncode==0 and created.stderr==b"" and len(created.stdout)<=4096,json.dumps({"tool":"venv-create","code":created.returncode,"stdout":created.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":created.stderr[:4096].decode("utf-8","backslashreplace")})',
      'child=subprocess.run([venv+"/bin/python","-I","-c","import json,os,sys;print(json.dumps({\\"version\\":sys.version.split()[0],\\"uid\\":os.getuid(),\\"prefix\\":sys.prefix}))"],capture_output=True,timeout=10)',
      'assert child.returncode==0 and child.stderr==b"" and len(child.stdout)<=4096,json.dumps({"tool":"venv-child","code":child.returncode,"stdout":child.stdout[:4096].decode("utf-8","backslashreplace"),"stderr":child.stderr[:4096].decode("utf-8","backslashreplace")})',
      'v={"uid":os.getuid(),"euid":os.geteuid(),"gid":os.getgid(),"home":os.environ.get("HOME"),"cwd":os.getcwd(),"path":os.environ.get("PATH"),"networkInode":str(os.stat("/proc/self/ns/net").st_ino),"noNewPrivs":status["NoNewPrivs"].strip(),"caps":{key:status[key].strip() for key in ("CapInh","CapPrm","CapEff","CapBnd","CapAmb")},"version":sys.version.split()[0],"executable":sys.executable,"executableRealPath":os.path.realpath(sys.executable),"executableDevice":str(metadata.st_dev),"executableInode":str(metadata.st_ino),"prefix":sys.prefix,"basePrefix":sys.base_prefix,"aliasPythonVersion":alias.stdout.decode("utf-8","strict").strip(),"pip":pip.stdout.decode("utf-8","strict").strip(),"pipPackages":json.loads(packages.stdout),"createdVenv":json.loads(child.stdout)}',
      'v["managed"]={"path":managed,"device":str(managedMetadata.st_dev),"inode":str(managedMetadata.st_ino),"uid":managedMetadata.st_uid,"mode":stat.S_IMODE(managedMetadata.st_mode),"projectReadableTraversable":os.access(managed,os.R_OK|os.X_OK)}',
      'v["realpathUtility"]={"path":realpath,"realpath":os.path.realpath(realpath),"device":str(realpathMetadata.st_dev),"inode":str(realpathMetadata.st_ino),"uid":realpathMetadata.st_uid,"mode":stat.S_IMODE(realpathMetadata.st_mode),"resolvedPip":resolvedPip.stdout.decode("utf-8","strict").strip(),"versionOutput":realpathVersion.stdout.decode("utf-8","strict").strip(),"code":resolvedPip.returncode,"stderr":resolvedPip.stderr.decode("utf-8","strict")}',
      'print(json.dumps(v))'
    ].join('\n');
    command = quote(binary) + ' -I -c ' + quote(body);
  } else {
    const body = [
      'const fs=require("node:fs");',
      'const status=Object.fromEntries(fs.readFileSync("/proc/self/status","utf8").split("\\n").filter(x=>x.includes(":")).map(x=>{const i=x.indexOf(":");return [x.slice(0,i),x.slice(i+1).trim()]}));',
      'const m=fs.statSync(process.execPath,{bigint:true});',
      'console.log(JSON.stringify({uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),home:process.env.HOME,cwd:process.cwd(),path:process.env.PATH,networkInode:String(fs.statSync("/proc/self/ns/net",{bigint:true}).ino),noNewPrivs:status.NoNewPrivs,caps:Object.fromEntries(["CapInh","CapPrm","CapEff","CapBnd","CapAmb"].map(k=>[k,status[k]])),version:process.version.slice(1),executable:process.execPath,executableDevice:String(m.dev),executableInode:String(m.ino)}));'
    ].join('\n');
    command = quote(binary) + ' -e ' + quote(body);
  }
  const result = await projectIdentityTask(machines, vmId, probeProject,
    { command, environment: selectedEnvironment }, new AbortController().signal, undefined, 60000);
  assert.equal(result.code, 0, result.stdout + result.stderr); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, version); assert.equal(report.executable, binary);
  assert.equal(report.executableDevice, receipt.executableDevice); assert.equal(report.executableInode, receipt.executableInode);
  assert.equal(report.uid, identity.uid); assert.equal(report.euid, identity.uid); assert.equal(report.gid, identity.gid);
  assert.equal(report.home, identity.home); assert.equal(report.cwd, probeDir); assert.equal(report.path, selectedEnvironment.PATH);
  assert.equal(report.noNewPrivs, '1'); for (const value of Object.values(report.caps)) assert.match(String(value), /^0+$/);
  const expectedNetwork = await guestPython('import os\nprint(os.stat("/run/netns/sk-' + probeId + '").st_ino)');
  assert.equal(report.networkInode, expectedNetwork);
  if (tool === 'python') {
    assert.equal(report.aliasPythonVersion, version); assert.equal(report.prefix, dirname(runtimeBin(tool, version)));
    assert.ok(report.basePrefix.startsWith(managedPath + '/')); assert.ok(report.executableRealPath.startsWith(managedPath + '/'));
    assert.equal(report.managed.path, managedPath); assert.equal(report.managed.device, full.managedInfo.device);
    assert.equal(report.managed.inode, full.managedInfo.inode); assert.equal(report.managed.projectReadableTraversable, true);
    assert.equal(report.managed.uid, 0); assert.equal(report.managed.mode, 0o755);
    assert.equal(report.realpathUtility.resolvedPip, runtimeBin(tool, version) + '/pip');
    assert.equal(report.realpathUtility.code, 0); assert.equal(report.realpathUtility.stderr, '');
    assert.equal(report.realpathUtility.uid, 0); assert.match(report.realpathUtility.versionOutput, /^realpath \(GNU coreutils\)/);
    assert.match(report.pip, /^pip \d+\.\d+(?:\.\d+)? from /);
    assert.ok(report.pip.includes(dirname(runtimeBin(tool, version)) + '/')); assert.equal(report.pip.includes(full.stage), false);
    assert.ok(report.pipPackages.some((entry: { name: string }) => entry.name.toLowerCase() === 'pip'));
    assert.equal(report.createdVenv.uid, identity.uid); assert.equal(report.createdVenv.version, version);
    assert.equal(report.createdVenv.prefix, probeDir + '/venv-relocation-check');
  }
  await preserveNeighbor();
  return { officialAdministratorInstall: true, tool, version, receipt, artifactStageRemoved: true,
    currentInstallApiTaskScopesReturnedToBaseline: { before: taskScopesBefore, after: taskScopesAfter },
    managed: managedPath ? { path: managedPath, identity: full.managedInfo, readyMetadata: managedMetadata,
      legacySharedDownloadsRootAndLockUnchanged: true, legacySharedMetadata: legacyBefore } : null,
    installerScopeRemoved: true, reusedPreviouslyVerifiedReadyArtifact: preexisting, selectedProbe: view,
    finalAbsoluteBinaryUidReport: report, cleanup: await assertClosed() };
};
const cleanupExpected = 17 + (installPython ? 1 : 0) + (installNode ? 1 : 0);
try {
  proof.phase = 'starting-owned-vm';
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  await machines.start(vmId);
  const deadline = Date.now() + 270000;
  while (machines.state(vmId) !== 'running') {
    assert.equal(machines.state(vmId), 'starting'); assert.ok(Date.now() < deadline, machines.logs.get(vmId)); await delay(300);
  }
  proof.bootId = await run(fixed + '/bin/cat /proc/sys/kernel/random/boot_id');
  if (distro === 'alpine') await run(fixed + '/sbin/rc-service cgroups start');
  proof.identityBuild = await core.install(vmId);
  const ids = JSON.parse(await guestPython("import json\nv=json.load(open('/var/lib/sakura/project-identities/registry.json'));print(json.dumps(sorted(x['projectId'] for x in v['reserved'].values())))"));
  for (const id of ids) oldIdentities[id] = await core.inspect(vmId, id);
  oldAccounts = await accountSnapshot();
  proof.originalAccountsSha256 = digest(JSON.stringify(oldAccounts));
  await guestPython('import os,stat\nfor p in ' + JSON.stringify([probeDir, neighborDir, rootOnlyDir]) +
    ':\n assert not os.path.lexists(p)\n os.mkdir(p,0o700)\n');
  for (const role of ['Probe', 'Neighbor']) {
    const directory = role === 'Probe' ? probeDir : neighborDir;
    const index = await spaces.projects.create(vmId, 'Owned runtime ' + role + ' ' + invocation.slice(0, 8), async () => {
      await spaces.save(vmId, { directory, networkIsolation: 'private', environment: role === 'Probe' ?
        { PATH: probeDir + '/bin:/usr/bin:/bin', RUNTIME_BODY: payloadCanary } : {} });
    });
    const id = index.active;
    if (role === 'Probe') probeId = id; else neighborId = id;
    await spaces.projects.inScope(vmId, id, async () => {
      const preview = await migrations.preview(vmId); assert.ok(preview.plan);
      await migrations.apply(vmId, { action: 'apply', version: 1, reviewed: true,
        planId: preview.plan!.proposal.planId, sha256: preview.plan!.sha256 });
      const job = await spaces.run(vmId, 'setup'); await spaces.jobs.wait(spaces.projects.key(vmId));
      assert.equal(job.status, 'done', job.error + '\n' + job.log);
    });
  }
  probeProject = await inProbe(() => spaces.config(vmId)); neighborProject = await inNeighbor(() => spaces.config(vmId));
  identity = await scopes.identity(vmId, probeProject); neighborIdentity = await scopes.identity(vmId, neighborProject);
  assert.notEqual(identity.uid, neighborIdentity.uid);
  await task(probeProject, 'import os\np=' + JSON.stringify(probeDir) +
    '\nos.mkdir(p+"/bin",0o700)\nf=os.open(p+"/bin/node",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)\n' +
    'os.write(f,' + JSON.stringify(fakeNodeBody) + '.encode());os.close(f)\nopen(p+"/mode","w").write("valid")\nopen(p+"/.nvmrc","w").write("v99.31.41\\n")');
  const neighborCode = [
    'import json,os,signal,time', 'signal.signal(signal.SIGTERM,signal.SIG_IGN)',
    'f=open("/proc/self/stat").read().rsplit(") ",1)[1].split()',
    'v={"pid":os.getpid(),"ticks":f[19],"uid":os.getuid(),"cgroup":open("/proc/self/cgroup").read().strip()}',
    'p=os.open(' + JSON.stringify(neighborDir + '/main.json') + ',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)',
    'os.write(p,json.dumps(v).encode());os.close(p)', 'while True:time.sleep(1)'
  ].join('\n');
  neighborProject = await inNeighbor(async () => {
    await spaces.save(vmId, { ...neighborProject, command: python(neighborCode) }); return spaces.config(vmId);
  });
  const started = await inNeighbor(() => spaces.run(vmId, 'start')); await spaces.jobs.wait(vmId + ':' + neighborId);
  assert.equal(started.status, 'done', started.error + '\n' + started.log);
  neighborProcess = await readOwnedJson(neighborDir + '/main.json', neighborIdentity.uid);
  proof.phase = 'running';
  await new Promise<void>(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); httpBase = 'http://127.0.0.1:' + address.port;
  await check('one-thousand-unprobed-http-gets-create-no-guest-work', () => getStorm(1000, 'unprobed'));
  await check('explicit-probe-uses-project-path-uid-caps-home-and-private-network', async () => {
    const value = await inProbe(() => versions.probe(vmId)); assert.equal(value.probe.state, 'cached');
    assert.equal(value.actual.node, '99.31.41'); assert.equal(value.declared.node, '99.31.41');
    assert.match(value.actual.python, /^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
    const report = await getReport();
    assert.equal(report.uid, identity.uid); assert.equal(report.euid, identity.uid); assert.equal(report.gid, identity.gid);
    assert.equal(report.home, identity.home); assert.equal(report.cwd, probeDir);
    assert.equal(report.path, probeProject.environment.PATH); assert.equal(report.bodyCanary, true);
    assert.equal(report.noNewPrivs, '1'); for (const value of Object.values(report.caps)) assert.match(String(value), /^0+$/);
    assert.equal(report.rootWriteDenied, true);
    const hostNet = await guestPython('import os\nprint(os.stat("/proc/self/ns/net").st_ino)');
    const privateNet = await guestPython('import os\nprint(os.stat("/run/netns/sk-' + probeId + '").st_ino)');
    assert.equal(report.networkInode, privateNet); assert.notEqual(report.networkInode, hostNet);
    await guestPython('import os\nassert not os.path.lexists(' + JSON.stringify(rootOnlyDir + '/forbidden-write') + ')');
    await preserveNeighbor();
    return { view: value, report, hostNetworkInode: hostNet, expectedPrivateNetworkInode: privateNet, cleanup: await assertClosed() };
  });
  await check('two-thousand-cached-http-gets-create-no-new-ticket-or-install', () => getStorm(2000, 'cached'));
  await check('another-project-cannot-read-probe-code-body', async () => {
    const result = JSON.parse(await task(neighborProject,
      'import json\np=' + JSON.stringify(probeDir + '/bin/node') +
      '\ntry:open(p,"rb").read();denied=False\nexcept PermissionError:denied=True\nprint(json.dumps({"denied":denied}))'));
    assert.equal(result.denied, true); await preserveNeighbor(); return { result, probeUid: identity.uid, neighborUid: neighborIdentity.uid };
  });
  for (const [kind, expected] of [
    ['fifo', 'RUNTIME_DECLARATION_FILE_TYPE'], ['symlink', 'RUNTIME_DECLARATION_FILE_TYPE'],
    ['nul', 'RUNTIME_DECLARATION_ENCODING'], ['invalid-utf8', 'RUNTIME_DECLARATION_ENCODING'],
    ['limit', 'RUNTIME_DECLARATION_LIMIT']
  ]) await check('declaration-' + kind + '-rejected-without-hanging', async () => {
    await task(probeProject, 'import os\np=' + JSON.stringify(probeDir + '/.nvmrc') +
      '\nos.unlink(p)\n' + (kind === 'fifo' ? 'os.mkfifo(p,0o600)' : kind === 'symlink' ?
        'os.symlink(' + JSON.stringify(rootOnlyDir + '/forbidden-read') + ',p)' :
        'open(p,"wb").write(' + (kind === 'nul' ? 'b"99.31.41\\x00\\n"' : kind === 'invalid-utf8' ? 'b"99.31.41\\xff\\n"' : 'b"9"*4097') + ')'));
    const result = await failProbe(expected);
    await task(probeProject, 'import os\np=' + JSON.stringify(probeDir + '/.nvmrc') + '\nos.unlink(p)\nopen(p,"w").write("v99.31.41\\n")');
    return result;
  });
  for (const [mode, expected] of [
    ['suffix', 'RUNTIME_TOOL_OUTPUT'], ['nul', 'RUNTIME_TOOL_ENCODING'], ['invalid-utf8', 'RUNTIME_TOOL_ENCODING'],
    ['limit', 'RUNTIME_TOOL_LIMIT'], ['stderr-limit', 'RUNTIME_TOOL_LIMIT']
  ]) await check('tool-' + mode + '-strict-output-rejected-and-cleaned', async () => {
    await setMode(mode); const result = await failProbe(expected); const report = await getReport();
    assert.equal(report.uid, identity.uid); assert.equal(report.rootWriteDenied, true); return { ...result, uid: report.uid };
  });
  await check('abort-cleans-new-group-setsid-and-doublefork-and-closes-full-ticket', async () => {
    await setMode('loop');
    const cancel = new AbortController(), startedAt = Date.now();
    let settled = false, reports: any[] | null = null;
    const pending = inProbe(() => versions.probe(vmId, cancel.signal)).then(value => {
      settled = true; return { value, error: null as any };
    }, error => { settled = true; return { value: null, error }; });
    const deadline = Date.now() + 3500;
    while (!reports) {
      if (settled) throw new Error('Probe ended before explicit abort; cancellation evidence is unavailable.');
      try { reports = await getLiveReports(); }
      catch (error) { cancel.abort(); await pending; throw error; }
      if (!reports) {
        if (Date.now() >= deadline) { cancel.abort(); await pending; throw new Error('Four owned descendants did not publish before the tool deadline.'); }
        await delay(20);
      }
    }
    let reportFailure: unknown;
    try {
      assert.equal(settled, false, 'This case must cancel a live probe before its tool timeout.');
      assert.equal(reports.length, 4);
      for (const process of reports) assert.equal(process.observedAlive, true);
      const [main, newgroup, detached, doublefork] = reports;
      assert.equal(newgroup.pgid, newgroup.pid); assert.equal(newgroup.sid, main.sid);
      assert.equal(detached.pgid, detached.pid); assert.equal(detached.sid, detached.pid);
      assert.equal(doublefork.pgid, doublefork.sid); assert.notEqual(doublefork.pid, doublefork.sid);
      assert.notEqual(doublefork.sid, main.sid);
    } catch (error) { reportFailure = error; }
    cancel.abort(); const ended = await pending;
    if (reportFailure) throw reportFailure;
    assert.ok(ended.error, 'Requested cancellation must not become a successful cached sample.');
    for (const process of reports) { assert.equal(process.uid, identity.uid); assert.equal(await alive(process), false); }
    const closed = await assertClosed(); const latest = (await journal()).runs.at(-1);
    assert.equal(latest.run.phase, 'closed');
    for (const process of reports) {
      assert.equal(process.cgroup, '0::/' + latest.run.cgroupName);
      assert.equal(process.noNewPrivs, '1');
      for (const value of Object.values(process.caps)) assert.match(String(value), /^0+$/);
    }
    await guestPython('import os\nassert not os.path.lexists("/sys/fs/cgroup/sakura-task-' + latest.runId + '")');
    await preserveNeighbor();
    return { reports, elapsedMs: Date.now() - startedAt, cleanup: closed, runId: latest.runId,
      error: { name: ended.error.name, code: ended.error.code || null }, neighborRetained: true };
  });
  await check('selection-cas-refuses-real-competing-save', async () => {
    await setMode('valid');
    const captured = await inProbe(() => spaces.config(vmId));
    let injected = false, refusal: any;
    spaces.save = (async (...call: Parameters<typeof nativeSave>) => {
      if (!injected && call[0] === vmId && call[3]) {
        injected = true; assert.equal(call[3], projectVersion(captured));
        await nativeSave(vmId, { ...captured, setup: '# runtime-owned-new-config-' + invocation }, undefined, projectVersion(captured));
      }
      return nativeSave(...call);
    }) as typeof spaces.save;
    try { await inProbe(() => versions.select(vmId, {})); }
    catch (error) { refusal = { status: (error as any).status, code: (error as any).code || null, message: (error as Error).message }; }
    finally { spaces.save = nativeSave; }
    assert.equal(injected, true); assert.equal(refusal?.status, 409);
    const current = await inProbe(() => spaces.config(vmId));
    assert.equal(current.setup, '# runtime-owned-new-config-' + invocation);
    assert.deepEqual(current.runtimes || {}, captured.runtimes || {});
    probeProject = current;
    const report = await getReport(); assert.equal(report.uid, identity.uid); assert.equal(report.euid, identity.uid);
    assert.equal(report.home, identity.home); assert.equal(report.cwd, probeDir); assert.equal(report.rootWriteDenied, true);
    assert.equal(report.noNewPrivs, '1'); for (const value of Object.values(report.caps)) assert.match(String(value), /^0+$/);
    await preserveNeighbor(); return { injectedRealSave: true, refusal, retainedVersion: projectVersion(current),
      selectionUidReport: report, cleanup: await assertClosed() };
  });
  await check('untrusted-runtime-artifact-without-admin-ready-receipt-cannot-be-selected', async () => {
    const fakeVersion = '99.' + randomBytes(2).readUInt16BE(0) % 1000 + '.' + randomBytes(2).readUInt16BE(0) % 1000;
    const path = runtimeBin('node', fakeVersion), base = dirname(path), marker = rootOnlyDir + '/untrusted-artifact-executed';
    await guestPython('import os,stat\nroot="/opt/sakura-runtimes"\nif not os.path.lexists(root):os.mkdir(root,0o755)\n' +
      'i=os.lstat(root);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and not i.st_mode&0o022\n' +
      'base=' + JSON.stringify(base) + ';assert not os.path.lexists(base);os.mkdir(base,0o755);os.mkdir(base+"/bin",0o755)\n' +
      'f=os.open(base+"/bin/node",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o755)\nos.write(f,' +
      JSON.stringify('#!/bin/sh\nprintf exploited > ' + quote(marker) + '\nprintf "v' + fakeVersion + '\\n"\n') + '.encode());os.close(f)');
    let code: string | undefined;
    try { await inProbe(() => versions.select(vmId, { node: fakeVersion })); }
    catch (error) { code = (error as any).code; if (!code) throw error; }
    assert.ok(code && ['RUNTIME_DESTINATION_UNKNOWN', 'RUNTIME_PATH_ABSENT'].includes(code), code);
    await guestPython('import os\nassert not os.path.lexists(' + JSON.stringify(marker) + ')');
    assert.deepEqual((await inProbe(() => spaces.config(vmId))).runtimes || {}, probeProject.runtimes || {});
    await preserveNeighbor(); return { fakeVersion, code, fakeArtifactExecuted: false, officialInstallClaimed: false };
  });
  if (installPython) {
    await check('real-administrator-python-install-ready-relocated-python-pip-and-project-uid-selection',
      () => installOfficial('python', installPython));
  }
  if (installNode) {
    await check('real-official-node-22-12-0-install-ready-absolute-bin-and-project-uid-selection',
      () => installOfficial('node', installNode));
  }
  if (!installPython && !installNode)
    proof.officialInstallBoundary = 'Not exercised here; empty-selection CAS is not installed-runtime selection evidence.';
  assert.equal(commands.some(command => command.includes(payloadCanary) || command.includes(Buffer.from(payloadCanary).toString('base64'))), false);
  proof.rootCommandArgvContainsNoProjectBodyCanary = true;
} catch (error) {
  proof.error = error instanceof Error ? error.stack || error.message : String(error); console.error(proof.error);
} finally {
  proof.cleanupErrors = [];
  spaces.save = nativeSave;
  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
  if (machines.live.has(vmId)) {
    for (const id of [probeId, neighborId].filter(Boolean) as string[]) {
      try {
        const job = await spaces.projects.inScope(vmId, id, () => spaces.run(vmId, 'stop'));
        await spaces.jobs.wait(vmId + ':' + id); assert.equal(job.status, 'done', job.error + '\n' + job.log);
        const closed = await assertClosed(id); proof['closed-' + id] = closed;
      } catch (error) { proof.cleanupErrors.push('Project cleanup ' + id + ': ' + String(error)); }
    }
    if (neighborProcess) {
      try { assert.equal(await alive(neighborProcess), false); proof.neighborFinallyStopped = true; }
      catch (error) { proof.cleanupErrors.push('Neighbor stop: ' + String(error)); }
    }
    try {
      for (const [id, original] of Object.entries(oldIdentities)) assert.deepEqual(await core.inspect(vmId, id), original);
      assert.deepEqual(await accountSnapshot(), oldAccounts);
      proof.originalIdentityAccountsUnchanged = true;
      await spaces.projects.update(vmId, originalCatalog.active); proof.originalSelectionRestored = true;
      for (const entry of preservedHostFiles) assert.equal(digest(await readFile(entry.file)), entry.sha256);
      proof.originalHostConfigsIdentitiesAndProofsUnchanged = true;
    } catch (error) { proof.cleanupErrors.push('Original preservation: ' + String(error)); }
  }
  machines.exec = nativeExec; machines.execInput = nativeInput; machines.connect = nativeConnect;
  machines.readGuestFile = nativeRead; machines.writeGuestFile = nativeWrite;
  try { await versions.close(); } catch (error) { proof.cleanupErrors.push('Runtime close: ' + String(error)); }
  try { await spaces.close(); } catch (error) { proof.cleanupErrors.push('Workspace close: ' + String(error)); }
  if (machines.live.has(vmId) && machines.state(vmId) === 'running') {
    try {
      const synced = await nativeExec(vmId, fixed + '/bin/sync', 30000);
      assert.equal(synced.code, 0, synced.stdout + synced.stderr);
      proof.syncedBeforeStopAt = new Date().toISOString();
    } catch (error) { proof.cleanupErrors.push('Owned guest sync: ' + String(error)); }
  }
  try { await machines.close(); } catch (error) { proof.cleanupErrors.push('Machines close: ' + String(error)); }
  proof.vmStopped = machines.state(vmId) === 'stopped'; proof.liveEntries = machines.live.size;
  proof.ownedQemuSettled = qemuExecutions.every(value => value.settled); proof.exactQemuMatches = exactQemu();
  proof.stoppedAt = new Date().toISOString(); proof.finalSourceSha256 = {};
  for (const [source, initial] of Object.entries(freeze.sourceSha256)) {
    const value = digest(await readFile(join(workspace, source))); proof.finalSourceSha256[source] = value;
    if (value !== initial) proof.cleanupErrors.push('Source changed: ' + source);
  }
  for (const entry of oldFiles) if (digest(await readFile(entry.file)) !== entry.sha256) proof.cleanupErrors.push('Old proof changed: ' + entry.file);
  proof.finalScriptSha256 = digest(await readFile(scriptFile));
  if (proof.finalScriptSha256 !== proof.scriptSha256) proof.cleanupErrors.push('Smoke source changed.');
  try {
    const finalPackaged = await projectIdentitySources();
    assert.deepEqual(finalPackaged.manifest, proof.packagedIdentityManifest);
    proof.packagedIdentityUnchanged = true;
  } catch (error) { proof.cleanupErrors.push('Packaged identity assets changed: ' + String(error)); }
  if (!proof.vmStopped || proof.liveEntries || !proof.ownedQemuSettled || proof.exactQemuMatches) proof.cleanupErrors.push('Owned VM processes did not settle.');
  proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === cleanupExpected;
  proof.phase = proof.passed ? 'finished' : 'failed';
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  console.log('Runtime identity proof: ' + proofFile);
}
if (!proof.passed) throw new Error('Runtime identity proof failed; retained at ' + proofFile);
