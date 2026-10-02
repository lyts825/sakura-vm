import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { ProjectIdentity } from '../server/project-identity.ts';

// Preparation is read-only. VM startup needs a separately captured source
// freeze, the exact closed test fixture, and the explicit --run-owned mode.
// Historical disks, accounts, projects, plans, journals and proofs are retained.
const archiveSha256 = 'a38d26f4cb81f768feddff79e2937fd3f39c83d3da8be3da7225e1087e62e4ed';
const fixture = {
  distro: 'ubuntu', folder: 'sakura-guest-task-dhGwI9',
  vmId: 'f7cf98e3-e839-4eae-a55c-a214a7bdf472',
  proof: 'gpg-agent-project-identity-evidence-49a12621-197d-4eea-b3dc-06e864567347.json',
  proofSha256: '8b91c6df1b2c4753cfcfb02f928fd6aae28cc4ff5e4b90d75d2465aa4888d6eb',
  exit: 'gpg-agent-project-identity-ubuntu-49a12621-197d-4eea-b3dc-06e864567347-exit.json',
};
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function sameSources(actual: Record<string, string>, expected: Record<string, string>) {
  const changed = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].filter(file => actual[file] !== expected[file]);
  assert.equal(changed.length, 0, 'Source freeze changed: ' + changed.slice(0, 10).join(', '));
}
const cases = [
  'real code-server listener uses exact project UID/GID/home/env/native run',
  'HTTP authentication and WebSocket integrated terminal use that listener',
  'host-network neighbor uses a separate project account and loopback bridge',
  'readonly reload preserves complete receipts and issues no install or prepare',
  'partial changed and malformed native receipts reject without metadata writes',
  'stop removes detached descendants and the original full cgroup while neighbor survives',
  'valid-digest malformed protected frame executes no project code',
  'guest TTL watchdog clears descendants while the host application is closed',
  'expired reload retires original native and host receipts after full-domain stop',
  'cold boot refuses old receipt and retires it without a native stop in the new boot',
];
type Pin = { path: string; sha256: string; bytes: number; device: number; inode: number; mtimeMs: number };
type BrowserService = { init(): Promise<void>; close(): Promise<void>;
  run(id: string, input: unknown, signal: AbortSignal, log: (line: string) => void): Promise<any>;
  view(id: string): Promise<any>; link(id: string): Promise<{ url: string; password: string; expiresAt: string }> };
type OwnedProject = { id: string; directory: string; identity: ProjectIdentity; network: 'host' | 'private'; port: number; hostPort: number };

async function pin(file: string): Promise<Pin> {
  const path = await realpath(file); assert.equal(path, resolve(file), 'A pinned path was redirected');
  const before = await lstat(path); assert.ok(before.isFile() && !before.isSymbolicLink());
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  const after = await lstat(path);
  for (const key of ['dev', 'ino', 'size', 'mtimeMs'] as const) assert.equal(after[key], before[key], path);
  return { path, sha256: digest.digest('hex'), bytes: before.size, device: before.dev, inode: before.ino, mtimeMs: before.mtimeMs };
}
function exactQemu(disk: string): number {
  const script = '$ProgressPreference="SilentlyContinue";$request=[Console]::In.ReadToEnd()|ConvertFrom-Json;' +
    '[Console]::Write(@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {' +
    '($_.Name -eq "sakura-qemu.exe" -or $_.Name -like "qemu-system*.exe") -and $_.CommandLine -and $_.CommandLine.Contains($request.disk)}).Count)';
  const result = execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { input: JSON.stringify({ disk }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.match(result.trim(), /^[0-9]+$/); return Number(result.trim());
}
async function sourceSnapshot(workspace: string, implementation: 'source') {
  const files = new Set([
    'package.json', 'package-lock.json', 'native/project-identity/protocol.h',
    'native/project-identity/launcher.c', 'native/project-identity/controller.py',
    relative(workspace, import.meta.filename).replaceAll('\\', '/'),
  ]);
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.add(relative(workspace, path).replaceAll('\\', '/'));
    }
  };
  await visit(join(workspace, 'server')); await visit(join(workspace, 'shared'));
  const result: Record<string, string> = {};
  for (const file of files) result[file] = (await pin(join(workspace, file))).sha256;
  return result;
}
async function validateOwned() {
  assert.equal(process.platform, 'win32'); assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  const workspace = await realpath('.'), parent = join(workspace, '.data/network-remaining-test-temp'),
    root = join(parent, fixture.folder), machine = join(root, 'machines', fixture.vmId);
  assert.equal(await realpath(root), root); assert.equal(await realpath(machine), machine);
  assert.equal(dirname(root), parent); assert.equal(basename(root), fixture.folder);
  const disk = await pin(join(machine, 'disk.qcow2'));
  assert.equal(exactQemu(disk.path), 0, 'The exact original fixture is active');
  const originalProof = await pin(join(root, fixture.proof)); assert.equal(originalProof.sha256, fixture.proofSha256);
  const old = JSON.parse(await readFile(originalProof.path, 'utf8'));
  assert.equal(old.fixture, root); assert.equal(old.vmId, fixture.vmId); assert.equal(old.distro, fixture.distro);
  assert.equal(old.passed, true); assert.equal(old.vmStopped, true); assert.equal(old.liveEntries, 0);
  assert.equal(old.exactQemuMatches, 0); assert.equal(old.ownedQemuSettled, true);
  let previousClosedProof = originalProof, previousClosedDisk = old.finalDisk;
  const ownProofs = (await readdir(root)).filter(name => /^browser-ide-project-identity-evidence-[a-f0-9-]{36}\.json$/.test(name));
  if (ownProofs.length) {
    const completed = await Promise.all(ownProofs.map(async name => ({ file: join(root, name),
      value: JSON.parse(await readFile(join(root, name), 'utf8')) })));
    const recent = completed.filter(item => typeof item.value.finishedAt === 'string')
      .sort((left, right) => right.value.finishedAt.localeCompare(left.value.finishedAt))[0];
    assert.ok(recent, 'An interrupted Browser invocation needs an exact cleanup proof');
    const value = recent.value;
    assert.equal(value.fixture, root); assert.equal(value.vmId, fixture.vmId);
    assert.equal(value.previousEvidence.sha256, originalProof.sha256);
    assert.equal(value.vmStopped, true); assert.equal(value.liveEntries, 0); assert.equal(value.ownedChildren, 0);
    assert.equal(value.exactQemuMatches, 0); assert.equal(value.ownedQemuSettled, true); assert.equal(value.ownedHostRunsClosed, true);
    assert.equal(value.originalHostEvidenceAndProjectsPreserved, true); assert.equal(value.originalBackingImageUnchanged, true);
    assert.ok(value.qemuExecutions.length && value.qemuExecutions.every((child: any) => child.exit && child.close && child.stdoutClosed && child.stderrClosed && child.settled));
    assert.equal(value.ownedProjects.length, 2);
    for (const project of value.ownedProjects) {
      assert.match(project.id, /^[a-f0-9]{16}$/);
      assert.equal(project.directory, '/srv/projects/browser-ide-' + value.invocation + '/' + (project.network === 'private' ? 'alpha' : 'beta'));
      const journal = JSON.parse(await readFile(join(machine, 'project-identities', project.id + '.json'), 'utf8'));
      assert.equal(journal.projectId, project.id); assert.ok(journal.runs.every((run: any) => run.phase === 'closed'));
    }
    previousClosedProof = await pin(recent.file); previousClosedDisk = value.finalDisk;
  }
  assert.deepEqual(disk, previousClosedDisk, 'Disk no longer matches the latest completed exact-owned proof');
  assert.ok(old.qemuExecutions.length && old.qemuExecutions.every((entry: any) => entry.spawned && entry.actualExit &&
    entry.actualClose && entry.stdoutEnded && entry.stdoutClosed && entry.stderrEnded && entry.stderrClosed && entry.settled));
  assert.ok(old.finalOwnedScopes.length && old.finalOwnedScopes.every((entry: any) => entry.physicalStreams === 0 &&
    entry.physicalHelpers === 0 && entry.independentOriginalProcessDeadCheck === true &&
    entry.nativeObservations.every((child: any) => child.actualClose)));
  const exit = await pin(join(parent, fixture.exit)), completed = JSON.parse(await readFile(exit.path, 'utf8'));
  assert.equal(completed.actualExitCode, 0); assert.equal(completed.proofSha256, originalProof.sha256);
  assert.equal(completed.proofFile, originalProof.path);
  const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.equal(records.length, 1); const record = records[0]; assert.equal(record.id, fixture.vmId);
  assert.equal(record.name, 'guest-task-cgroup-smoke'); assert.equal(record.distro, 'ubuntu');
  assert.equal(record.bootstrapped, true); assert.equal(record.forwards.length, 0);
  const index = JSON.parse(await readFile(join(machine, 'projects.json'), 'utf8'));
  assert.ok(index.projects.length <= 18, 'Two new owned projects need free catalog slots; old projects are retained');
  const archive = await pin(join(workspace, '.data/browser-ide-4.132.0.tar.gz')); assert.equal(archive.sha256, archiveSha256);
  const qemu = await pin(join(workspace, '.tools/qemu/qemu-system-x86_64.exe')),
    seed = await pin(join(machine, 'seed.iso')), key = await pin(join(machine, 'id_rsa'));
  const imageTool = await pin(join(workspace, '.tools/qemu/qemu-img.exe')),
    base = await pin(join(workspace, '.data/images/ubuntu-24.04.qcow2'));
  const imageInfo = JSON.parse(execFileSync(imageTool.path, ['info', '--output=json', disk.path],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }));
  assert.equal(imageInfo.format, 'qcow2'); assert.equal(imageInfo['dirty-flag'], false);
  assert.equal(imageInfo['full-backing-filename'], base.path); assert.equal(imageInfo['virtual-size'], record.diskGiB * 1073741824);
  assert.equal(qemu.sha256, old.startupHarness.originalRuntimeInputs.qemu.sha256);
  assert.equal(seed.sha256, old.startupHarness.originalRuntimeInputs.seed.sha256);
  assert.equal(key.sha256, old.startupHarness.originalRuntimeInputs.sshPrivate.sha256);
  const preserved: Record<string, string> = {};
  const preserve = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const path = join(directory, entry.name);
      if (entry.isDirectory() && ['project-identities', 'project-main', 'project-services', 'project-ssh', 'project-directory-migrations'].includes(entry.name)) await preserve(path);
      else if (entry.isDirectory() && directory !== root && directory !== machine) await preserve(path);
      else if (entry.isFile() && entry.name.endsWith('.json') && !['machines.json', 'projects.json', 'boot-guard.json'].includes(entry.name))
        preserved[path] = (await pin(path)).sha256;
    }
  };
  await preserve(root); await preserve(machine);
  return { workspace, parent, root, machine, disk, archive, qemu, seed, key, base, imageTool, imageInfo, record, index, originalProof,
    previousClosedProof, exit, preserved,
    closedEvidence: { vmStopped: true, liveEntries: 0, ownedQemuChildren: 0,
      ownedNativeHelpers: 0, exactQemuMatches: 0, parentExitCode: 0 } };
}
type Setup = Awaited<ReturnType<typeof validateOwned>>;

// Root observations read kernel metadata and test-produced bounded JSON only.
// Request values remain in inherited stdin; root never interprets a project body.
const observer = String.raw`import glob,hashlib,json,os,stat,sys
r=json.load(sys.stdin)
assert r['operation'] in ('baseline','domain','terminal','stopped')
def meta(s):return {'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
def read(path,limit=1048576):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  raise ValueError('observation exceeded bound')
 finally:os.close(fd)
def proc(pid):
 path='/proc/'+str(pid)
 try:
  before=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[0] in (b'Z',b'X',b'x'):return None
  status=dict(line.split(':',1) for line in read(path+'/status',65536).decode().splitlines() if ':' in line)
  env=dict(row.split('=',1) for row in read(path+'/environ',131072).decode().split('\0') if '=' in row)
  network=os.stat(path+'/ns/net'); fds=[]
  for name in os.listdir(path+'/fd'):
   try:fds.append(os.readlink(path+'/fd/'+name))
   except (FileNotFoundError,ProcessLookupError):pass
  value={'pid':pid,'ticks':before[19].decode(),'uid':[int(v) for v in status['Uid'].split()],
   'gid':[int(v) for v in status['Gid'].split()],'groups':[int(v) for v in status['Groups'].split()],
   'caps':{k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
   'home':env.get('HOME'),'user':env.get('USER'),'logname':env.get('LOGNAME'),
   'marker':env.get('SAKURA_BROWSER_IDE_UID_TEST'),'frameEnv':env.get('SAKURA_BROWSER_IDE_FRAME_ENV'),
   'cwd':os.readlink(path+'/cwd'),'scope':read(path+'/cgroup',4096).decode().strip(),
   'network':meta(network),'command':read(path+'/cmdline',65536).decode().replace('\0',' '),
   'authorityDescriptors':[v for v in fds if '/var/lib/sakura/project-identities' in v or '/run/sakura-browser-ide/' in v or v.startswith('/sys/fs/cgroup/')],
   'socketInodes':[v[8:-1] for v in fds if v.startswith('socket:[') and v.endswith(']')]}
  after=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  assert before[19]==after[19] and after[0] not in (b'Z',b'X',b'x')
  return value
 except (FileNotFoundError,ProcessLookupError):return None
boot=read('/proc/sys/kernel/random/boot_id',128).decode().strip()
if r['operation']=='baseline':
 print(json.dumps({'bootId':boot,'passwd':read('/etc/passwd',262144).decode().splitlines(),'group':read('/etc/group',262144).decode().splitlines()}));sys.exit()
if r['operation']=='terminal':
 data=read(r['path'],65536);s=os.lstat(r['path']);assert stat.S_ISREG(s.st_mode) and s.st_uid==r['uid']
 print(json.dumps({'report':json.loads(data),'file':meta(s),'sha256':hashlib.sha256(data).hexdigest()}));sys.exit()
run=r['run']; path='/sys/fs/cgroup/'+run['cgroupName']; domain=None; members=[]; listeners=[]
if os.path.lexists(path):
 s=os.lstat(path);assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022
 domain=meta(s);assert domain['device']==run['cgroupDevice'] and domain['inode']==run['cgroupInode']
 for file in glob.glob('/proc/[0-9]*/cgroup'):
  try:scope=read(file,4096).decode().strip()
  except (FileNotFoundError,ProcessLookupError):continue
  if scope=='0::/'+run['cgroupName'] or scope.startswith('0::/'+run['cgroupName']+'/'):
   value=proc(int(file.split('/')[2]))
   if value:members.append(value)
 for member in members:
  try:rows=read('/proc/'+str(member['pid'])+'/net/tcp',1048576).decode().splitlines()[1:]
  except (FileNotFoundError,ProcessLookupError):continue
  for row in rows:
   values=row.split()
   if len(values)>9 and values[3]=='0A' and values[9] in member['socketInodes'] and int(values[1].split(':')[1],16)==r['port']:
    listeners.append({'address':values[1],'socketInode':values[9],'process':member})
children=[]
for child in r.get('children',[]):
 value=proc(child['pid']);children.append({'pid':child['pid'],'ticks':child['ticks'],'sameProcessAlive':bool(value and value['ticks']==child['ticks'])})
owner=None
try:owner=json.loads(read('/run/sakura-browser-ide/'+r['projectId']+'/owner.json',65536))
except FileNotFoundError:pass
print(json.dumps({'bootId':boot,'domain':domain,'members':members,'listeners':listeners,'children':children,'owner':owner}))
`;

async function runSmoke(setup: Setup, frozen: any) {
  const invocation = randomUUID(), marker = 'browser-uid-' + invocation, frameEnv = 'UTF-8 春\nquote\" apostrophe\' ' + invocation;
  const ownHost = join(setup.root, 'browser-ide-owned-' + invocation); await mkdir(ownHost);
  const proofFile = join(setup.root, 'browser-ide-project-identity-evidence-' + invocation + '.json'),
    stateFile = join(ownHost, 'browser-ide.json');
  const proof: any = { version: 1, invocation, fixture: setup.root, vmId: fixture.vmId, distro: fixture.distro,
    startedAt: new Date().toISOString(), passed: false, expectedCases: cases, cases: [], cleanupErrors: [],
    sourceFreeze: frozen, previousEvidence: setup.originalProof, previousClosedDiskEvidence: setup.previousClosedProof,
    archive: setup.archive, baseImage: setup.base, diskImageInfo: setup.imageInfo,
    closedEvidence: setup.closedEvidence, qemuExecutions: [], rootCommands: [], terminalWebSockets: [],
    testOnlyStartup: { engine: 'owned direct QEMU; no default runtime construction',
      clock: 'Ubuntu multi-threaded TCG without icount', memoryMiB: 3072,
      cloudReadinessCommandUnchanged: true, readinessHandshakeBudgetMs: 10000 }, ownedProjects: [], ownedHost: ownHost };
  const persist = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  process.env.SAKURA_DATA_DIR = setup.root; process.env.SAKURA_IMAGE_DIR = join(setup.workspace, '.data/images');
  process.env.TEMP = process.env.TMP = ownHost;
  const { Machines } = await import('../server/machines.ts');
  const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
  const { ProjectIdentities } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { Jobs } = await import('../server/jobs.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { quote } = await import('../server/files.ts');
  const { freePort } = await import('../server/qmp.ts');
  const { diskOptions } = await import('../shared/hardware.ts');
  const implementation = 'server';
  const browserModule = await import(pathToFileURL(join(setup.workspace, implementation, 'browser-ide.ts')).href),
    scopeModule = await import(pathToFileURL(join(setup.workspace, implementation, 'project-service-scope.ts')).href);
  assert.equal(typeof browserModule.browserIdeSessionSchema, 'object');
  assert.equal(typeof scopeModule.ProjectBrowserIdeScope, 'function');
  assert.equal(browserModule.browserIdePackage.sha256, archiveSha256);
  const children = new Map<ChildProcess, Promise<void>>(); let bootCount = 0;
  const unsupported = () => { throw new Error('Unknown owned browser smoke runtime operation'); };
  const engine: Engine = {
    version: 'test-only owned direct-spawn Engine', whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
    get service() { return unsupported(); }, runStatus: unsupported,
    runtime: { close: async () => {
      for (const child of children.keys()) child.kill();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([Promise.all(children.values()), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned QEMU close missing')), 10000);
      })]); } finally { clearTimeout(timer); }
    } },
    run: async (tool: string, args: string[], options: NonNullable<Parameters<Engine['run']>[2]> = {}) => {
      assert.equal(tool, 'sakura-qemu'); assert.ok(bootCount < 2, 'Only initial and cold boot are authorized');
      assert.equal(exactQemu(setup.disk.path), 0); assert.equal((await pin(setup.qemu.path)).sha256, setup.qemu.sha256);
      assert.equal((await pin(setup.seed.path)).sha256, setup.seed.sha256); assert.equal((await pin(setup.key.path)).sha256, setup.key.sha256);
      assert.deepEqual(await pin(setup.base.path), setup.base, 'Original backing image changed');
      assert.equal((await lstat(setup.disk.path)).ino, setup.disk.inode, 'The original owned disk was replaced');
      const escape = (value: string) => value.replaceAll(',', ',,');
      assert.deepEqual(args.flatMap((arg, i) => arg === '-drive' ? [args[i + 1]] : []), [
        `file=${escape(setup.disk.path)},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(setup.record)}`,
        `file=${escape(setup.seed.path)},if=virtio,format=raw,readonly=on`,
      ]);
      assert.equal(args[args.indexOf('-name') + 1], 'sakura-' + setup.record.name);
      assert.equal(args[args.indexOf('-accel') + 1], 'tcg,thread=single'); assert.ok(args.includes('-no-reboot'));
      for (const flag of ['-snapshot', '-blockdev', '-incoming', '-object', '-kernel', '-initrd', '-readconfig']) assert.ok(!args.includes(flag));
      const executed = [...args], clock = executed.indexOf('-icount'); assert.ok(clock >= 0);
      assert.equal(executed[clock + 1], 'shift=auto,sleep=on'); executed.splice(clock, 2);
      executed[executed.indexOf('-accel') + 1] = 'tcg,thread=multi';
      assert.equal(executed[executed.indexOf('-m') + 1], String(setup.record.memoryMiB));
      executed[executed.indexOf('-m') + 1] = '3072';
      const receipt: any = { boot: ++bootCount, pid: null, requestedArgvSha256: hash(JSON.stringify(args)),
        executedArgvSha256: hash(JSON.stringify(executed)), testOnlyClock: proof.testOnlyStartup.clock,
        testOnlyMemoryMiB: 3072, diskBefore: await pin(setup.disk.path), exit: null, close: false,
        stdoutClosed: false, stderrClosed: false, settled: false };
      proof.qemuExecutions.push(receipt); await persist();
      const child = spawn(setup.qemu.path, executed, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); receipt.pid = child.pid;
      let failure: Error | undefined, errorTail = '';
      child.once('error', error => { failure = error; });
      child.stdout!.on('data', value => options.output?.(value));
      child.stderr!.on('data', value => { options.output?.(value); errorTail = (errorTail + value.toString()).slice(-8192); });
      child.once('exit', (code, signal) => { receipt.exit = { code, signal, at: new Date().toISOString() }; });
      const closed = new Promise<void>(done => child.once('close', (code, signal) => {
        receipt.close = true; receipt.code = code; receipt.signal = signal;
        receipt.stdoutClosed = child.stdout!.closed; receipt.stderrClosed = child.stderr!.closed;
        children.delete(child); done();
      })); children.set(child, closed);
      const abort = () => child.kill(); options.signal?.addEventListener('abort', abort, { once: true });
      try { await closed; if (failure) throw failure; if (options.signal?.aborted) return '';
        assert.equal(receipt.code, 0, errorTail); assert.equal(receipt.signal, null); return '';
      } finally { receipt.settled = true; options.signal?.removeEventListener('abort', abort); }
    },
  } as unknown as Engine;
  const machines = new Machines(engine), spaces = new Workspaces(machines), core = new ProjectIdentities(machines),
    migrations = new ProjectDirectoryMigrations(machines, spaces);
  await spaces.jobs.close(); spaces.jobs = new Jobs('owned-browser-ide', join(ownHost, 'jobs'));
  let service: BrowserService = new browserModule.BrowserIde(machines, spaces, stateFile),
    nativeReplyFault = false, readonlyPhase = false;
  const originalExec = machines.exec.bind(machines), originalInput = machines.execInput.bind(machines),
    originalStart = scopeModule.ProjectBrowserIdeScope.prototype.start,
    originalInstall = ProjectIdentities.prototype.install;
  ProjectIdentities.prototype.install = async function (...call: Parameters<typeof originalInstall>) {
    assert.equal(readonlyPhase, false, 'A readonly Browser operation attempted a native installation');
    return originalInstall.apply(this, call);
  };
  let malformedFrame: { projectId: string; markerPath: string; mutated: boolean; runId?: string } | undefined;
  const inspect = (command: string, input?: Buffer) => {
    assert.ok(!command.includes(marker) && !command.includes(frameEnv), 'Project environment appeared in root argv');
    const entry: any = { sha256: hash(command), projectBodyAbsent: true, action: command.match(/^# ([A-Z_]+)/)?.[1],
      inputBytes: input?.length, inputSha256: input ? hash(input) : undefined,
      protectedFrame: !!input?.subarray(0, 8).equals(Buffer.from('SKIDP001')) };
    proof.rootCommands.push(entry); return entry;
  };
  const readonlyAction = (command: string) => {
    const encoded = command.match(/'([A-Za-z0-9+/=]+)'$/)?.[1];
    if (!encoded) return undefined;
    try { const value = JSON.parse(Buffer.from(encoded, 'base64').toString()); return value.action; } catch { return undefined; }
  };
  machines.exec = (async (...call: Parameters<typeof originalExec>) => {
    assert.equal(call[0], fixture.vmId); const receipt = inspect(call[1]);
    receipt.nativeAction = readonlyAction(call[1]);
    if (readonlyPhase) assert.ok(!['ensure', 'prepare', 'ssh-prepare', 'exec-current', 'network-bind'].includes(receipt.nativeAction),
      'Readonly Browser operation attempted native issuance');
    if (machines.state(fixture.vmId) === 'starting') {
      assert.equal(call[1], 'test -f /var/lib/cloud/instance/boot-finished && test -d /workspace && /bin/sync');
      receipt.startupCommandUnchanged = true; receipt.requestedTimeout = call[2]; call[2] = Math.max(call[2] ?? 0, 10000);
      receipt.effectiveTimeout = call[2];
    }
    const result = await originalExec(...call); receipt.code = result.code;
    if (nativeReplyFault && receipt.nativeAction === 'run-readonly') {
      receipt.injectedTrailingBytes = true; return { ...result, stdout: result.stdout + '\nnot-json' };
    }
    return result;
  }) as typeof machines.exec;
  machines.execInput = (async (...call: Parameters<typeof originalInput>) => {
    assert.equal(call[0], fixture.vmId); const receipt = inspect(call[1], call[2]);
    const result = await originalInput(...call); receipt.code = result.code; return result;
  }) as typeof machines.execInput;
  // This deliberate negative mutates only this invocation's alpha frame. Real
  // host admission, service helper, staging hash and the fixed native launcher
  // still execute. The frame digest is updated to reach native flag validation.
  scopeModule.ProjectBrowserIdeScope.prototype.start = async function (record: any, payload: any, signal: AbortSignal) {
    if (malformedFrame && malformedFrame.projectId === record.projectId && !malformedFrame.mutated) {
      const original = Buffer.from(payload.input); assert.equal(original.subarray(0, 8).toString(), 'SKIDP001');
      const scriptBytes = original.readUInt32LE(24), body = original.subarray(32, 32 + scriptBytes),
        markerBody = Buffer.from('printf frame-began > ' + quote(malformedFrame.markerPath) + '\n');
      const header = Buffer.from(original.subarray(0, 32));
      header.writeUInt32LE(3, 12); header.writeUInt32LE(original.readUInt32LE(16) + markerBody.length, 16);
      header.writeUInt32LE(scriptBytes + markerBody.length, 24);
      const input = Buffer.concat([header, markerBody, body, original.subarray(32 + scriptBytes)]), sha256 = hash(input);
      const match = payload.command.match(/'([A-Za-z0-9+/=]+)'$/); assert.ok(match);
      const request = JSON.parse(Buffer.from(match[1], 'base64').toString());
      assert.equal(request.action, 'exec-current'); assert.equal(request.runId, record.runId); assert.equal(request.payloadSha256, payload.sha256);
      request.payloadSha256 = sha256;
      const command = payload.command.slice(0, match.index) + quote(Buffer.from(JSON.stringify(request)).toString('base64'));
      malformedFrame.mutated = true; malformedFrame.runId = record.runId;
      proof.frameFault = { runId: record.runId, originalSha256: payload.sha256, mutatedSha256: sha256,
        flags: 3, projectBodyMarker: malformedFrame.markerPath, inheritedDigestRequestUpdated: true,
        lengthFieldsConsistent: true, markerBodyStayedInProtectedStdin: true };
      return originalStart.call(this, record, { ...payload, input, sha256, command }, signal);
    }
    return originalStart.call(this, record, payload, signal);
  };
  const projects: OwnedProject[] = [], processPins = new Map<string, { pid: number; ticks: string }[]>();
  const browsers = new Set<import('@playwright/test').Browser>();
  const guest = async (command: string, timeout = 30000) => {
    const result = await machines.exec(fixture.vmId, command, timeout); assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
  };
  const observe = async (request: object) => {
    const result = await machines.execInput(fixture.vmId, '/usr/bin/python3 -I -S -c ' + quote(observer), Buffer.from(JSON.stringify(request)), 30000);
    assert.equal(result.code, 0, result.stderr || result.stdout); return JSON.parse(result.stdout);
  };
  const inProject = <T>(project: OwnedProject, action: () => Promise<T>) => spaces.projects.with(fixture.vmId, project.id, action);
  const saved = async (project: OwnedProject) => {
    const store = JSON.parse(await readFile(stateFile, 'utf8')), session = store.sessions.find((value: any) => value.projectId === project.id);
    assert.ok(session?.execution?.run); return session;
  };
  const journal = async (project: OwnedProject) => JSON.parse(await readFile(join(setup.machine, 'project-identities', project.id + '.json'), 'utf8'));
  const entry = async (project: OwnedProject, runId: string) => (await journal(project)).runs.find((run: any) => run.runId === runId) ||
    JSON.parse(await readFile(join(setup.machine, 'project-identities', project.id, 'closed-runs', runId + '.json'), 'utf8'));
  const domain = async (project: OwnedProject, session: any) => observe({ operation: 'domain', projectId: project.id,
    run: session.execution.run, port: session.guestPort, children: processPins.get(session.execution.run.runId) || [] });
  const assertStopped = async (project: OwnedProject, session: any, hostClosed = true) => {
    const value = await domain(project, session); assert.equal(value.domain, null); assert.equal(value.members.length, 0);
    assert.ok(value.children.every((child: any) => !child.sameProcessAlive));
    if (value.bootId === session.execution.run.bootId) assert.equal(value.owner?.phase, 'stopped');
    if (hostClosed) assert.equal((await entry(project, session.execution.run.runId)).phase, 'closed');
    return value;
  };
  const start = async (project: OwnedProject, ttlMinutes = 20) => inProject(project, () => service.run(fixture.vmId,
    { mode: 'start', guestPort: project.port, hostPort: project.hostPort, ttlMinutes }, new AbortController().signal, () => {}));
  const stop = async (project: OwnedProject) => inProject(project, () => service.run(fixture.vmId, { mode: 'stop' }, new AbortController().signal, () => {}));
  const auth = async (project: OwnedProject) => {
    const link = await inProject(project, () => service.link(fixture.vmId));
    assert.match(link.password, /^[a-f0-9]{64}$/);
    const request = async (path: string, options: RequestInit = {}) => fetch(link.url + path,
      { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const anonymous = await request(''); assert.ok([302, 303, 307].includes(anonymous.status));
    assert.match(anonymous.headers.get('location') || '', /\/login/); await anonymous.body?.cancel();
    const invalid = await request('login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'invalid-owned-password' }) }); assert.equal(invalid.status, 200); await invalid.body?.cancel();
    const accepted = await request('login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: link.password }) }); assert.ok(accepted.status >= 300 && accepted.status < 400);
    const cookie = accepted.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); await accepted.body?.cancel();
    const opened = await request('', { headers: { cookie } }); assert.equal(opened.status, 200);
    assert.match(opened.headers.get('content-type') || '', /text\/html/); assert.match(await opened.text(), /monaco|code-server|<html/i);
    return { link, cookie };
  };
  const terminal = async (project: OwnedProject, label: string) => {
    const { link, cookie } = await auth(project), { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true }); browsers.add(browser);
    try {
      const context = await browser.newContext(), equals = cookie.indexOf('=');
      await context.addCookies([{ name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: link.url }]);
      const page = await context.newPage(), sockets: any[] = [];
      page.on('websocket', socket => {
        const receipt = { projectId: project.id, url: socket.url(), sent: 0, received: 0, closed: false };
        sockets.push(receipt); proof.terminalWebSockets.push(receipt);
        socket.on('framesent', () => receipt.sent++); socket.on('framereceived', () => receipt.received++);
        socket.on('close', () => receipt.closed = true);
      });
      await page.goto(link.url + '?folder=' + encodeURIComponent(project.directory));
      await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 90000 });
      const trust = page.getByRole('button', { name: /Yes, I trust the authors/ });
      if (await trust.isVisible()) await trust.click();
      const restricted = page.getByText('Restricted Mode', { exact: true });
      if (await restricted.isVisible()) {
        await restricted.click(); await page.getByRole('button', { name: 'Trust', exact: true }).click({ timeout: 15000 });
        await trust.click({ timeout: 5000 }).catch(() => {}); await restricted.waitFor({ state: 'hidden', timeout: 15000 });
      }
      await page.keyboard.press('Control+Shift+Backquote');
      await page.locator('.xterm-helper-textarea').first().focus({ timeout: 30000 });
      const report = project.directory + '/terminal-' + label + '.json';
      const body = 'import json,os,subprocess,time\n' +
        "child=subprocess.Popen(['/usr/bin/python3','-I','-S','-c','import time;time.sleep(900)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\n" +
        "time.sleep(.1)\nf=open('/proc/'+str(child.pid)+'/stat').read().rsplit(') ',1)[1].split()\n" +
        "status=dict(row.split(':',1) for row in open('/proc/self/status') if ':' in row)\n" +
        "value={'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'groups':os.getgroups(),'home':os.environ['HOME'],'cwd':os.getcwd(),'marker':os.environ.get('SAKURA_BROWSER_IDE_UID_TEST'),'frameEnv':os.environ.get('SAKURA_BROWSER_IDE_FRAME_ENV'),'scope':open('/proc/self/cgroup').read().strip(),'networkInode':str(os.stat('/proc/self/ns/net').st_ino),'caps':{k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},'child':{'pid':child.pid,'ticks':f[19],'session':os.getsid(child.pid)}}\n" +
        'fd=os.open(' + JSON.stringify(report) + ',os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)\n' +
        'with os.fdopen(fd,"w") as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())';
      const terminalProgram = "exec(__import__('base64').b64decode('" + Buffer.from(body).toString('base64') + "'))";
      await page.keyboard.type('/usr/bin/python3 -I -S -c ' + quote(terminalProgram)); await page.keyboard.press('Enter');
      await waitFor(async () => (await machines.exec(fixture.vmId, 'test -f ' + quote(report), 10000)).code === 0, 'Integrated terminal report missing', 45000);
      const value = await observe({ operation: 'terminal', path: report, uid: project.identity.uid }), session = await saved(project);
      assert.equal(value.report.uid, project.identity.uid); assert.equal(value.report.euid, project.identity.uid);
      assert.equal(value.report.gid, project.identity.gid); assert.deepEqual(value.report.groups, []);
      assert.equal(value.report.home, project.identity.home); assert.equal(value.report.cwd, project.directory);
      assert.equal(value.report.marker, marker); assert.equal(value.report.frameEnv, frameEnv);
      assert.equal(value.report.scope, '0::/' + session.execution.run.cgroupName);
      assert.equal(value.report.networkInode, session.execution.run.networkInode);
      for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.equal(BigInt('0x' + value.report.caps[name]), 0n);
      assert.equal(value.report.caps.NoNewPrivs, '1'); assert.equal(value.report.child.session, value.report.child.pid);
      const previous = processPins.get(session.execution.run.runId) || []; previous.push(value.report.child); processPins.set(session.execution.run.runId, previous);
      assert.ok(sockets.some(socket => socket.received > 0 && socket.sent > 0), 'No real editor WebSocket traffic observed');
      await page.screenshot({ path: join(ownHost, 'terminal-' + label + '.png') });
      return { terminal: value, websocketCount: sockets.length, actualBidirectionalWebSocket: true };
    } finally { await browser.close(); browsers.delete(browser); }
  };
  const check = async (name: string, work: () => Promise<any>) => {
    console.log('PHASE ' + name); proof.activeCase = name; await persist();
    const observation = await work(); proof.cases.push({ name, observation }); delete proof.activeCase; await persist(); console.log('PASS ' + name);
  };
  let baseline: any;
  try {
    await machines.init(); assert.equal(machines.state(fixture.vmId), 'stopped'); assert.equal(machines.live.size, 0);
    await service.init(); await machines.start(fixture.vmId);
    await waitFor(() => machines.state(fixture.vmId) !== 'starting', 'Original owned VM did not boot', 300000);
    assert.equal(machines.state(fixture.vmId), 'running', (await machines.view(fixture.vmId)).lastError);
    baseline = await observe({ operation: 'baseline' }); proof.originalGuestAccounts = baseline;
    await core.install(fixture.vmId);
    const cache = browserModule.browserIdePackage.cachePath;
    await guest('mkdir -p ' + quote(dirname(cache)) + '; chmod 700 ' + quote(dirname(cache)));
    const cached = await machines.exec(fixture.vmId, 'test -f ' + quote(cache) + ' && sha256sum ' + quote(cache), 30000);
    if (cached.code !== 0 || cached.stdout.trim().split(/\s+/)[0] !== archiveSha256) {
      const client = await machines.connect(fixture.vmId, 30000);
      try {
        const sftp = await new Promise<import('ssh2').SFTPWrapper>((yes, no) => client.sftp((error, value) => error ? no(error) : yes(value)));
        try { await new Promise<void>((yes, no) => sftp.fastPut(setup.archive.path, cache, error => error ? no(error) : yes())); }
        finally { sftp.end(); }
      } finally { client.end(); }
      proof.cachePreloadedByOwnedRootSftp = true;
    }
    assert.equal((await guest('sha256sum ' + quote(cache))).split(/\s+/)[0], archiveSha256);
    const parent = '/srv/projects/browser-ide-' + invocation;
    await guest('mkdir -p /srv/projects; mkdir ' + quote(parent) + '; chmod 755 /srv/projects ' + quote(parent));
    for (const [name, network, port] of [['alpha', 'private', 8080], ['beta', 'host', 8081]] as const) {
      const directory = parent + '/' + name; await guest('mkdir ' + quote(directory));
      const config = projectSchema.parse({ directory, template: 'none', networkIsolation: network,
        environment: { SAKURA_BROWSER_IDE_UID_TEST: marker, SAKURA_BROWSER_IDE_FRAME_ENV: frameEnv } });
      const index = await spaces.projects.create(fixture.vmId, 'browser-' + name + '-' + invocation.slice(0, 8), () => writeStore(spaces.projects.file(fixture.vmId), config));
      const identity = await spaces.projects.with(fixture.vmId, index.active, async () => {
        const preview = await migrations.preview(fixture.vmId); assert.ok(preview.plan);
        const applied = await migrations.apply(fixture.vmId, { action: 'apply', version: 1,
          planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
        assert.equal(applied.plan?.state, 'applied'); return applied.plan!.activatedIdentity!;
      });
      const project: OwnedProject = { id: index.active, identity, directory, network, port, hostPort: await freePort() };
      projects.push(project); proof.ownedProjects.push(project); await persist();
    }
    const [alpha, beta] = projects; await start(alpha); const initial = await saved(alpha);
    await check(cases[0], async () => {
      const observed = await domain(alpha, initial); assert.equal(observed.bootId, initial.execution.run.bootId);
      assert.ok(observed.listeners.length && observed.listeners.every((listener: any) => listener.address === '0100007F:1F90'));
      for (const listener of observed.listeners) {
        const process = listener.process; assert.deepEqual(process.uid, [alpha.identity.uid, alpha.identity.uid, alpha.identity.uid, alpha.identity.uid]);
        assert.deepEqual(process.gid, [alpha.identity.gid, alpha.identity.gid, alpha.identity.gid, alpha.identity.gid]);
        assert.equal(process.home, alpha.identity.home); assert.equal(process.marker, marker); assert.equal(process.frameEnv, frameEnv);
        assert.equal(process.network.inode, initial.execution.run.networkInode); assert.equal(process.network.device, initial.execution.run.networkDevice);
        assert.equal(process.authorityDescriptors.length, 0); assert.match(process.command, /code-server/);
      }
      assert.ok(proof.rootCommands.some((command: any) => command.protectedFrame && command.inputSha256 === initial.execution.sha256));
      for (const listener of observed.listeners) {
        assert.deepEqual(listener.process.groups, []);
        for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.equal(BigInt('0x' + listener.process.caps[name]), 0n);
        assert.equal(listener.process.caps.NoNewPrivs, '1');
      }
      assert.equal(machines.get(fixture.vmId).forwards.length, 0); return observed;
    });
    await check(cases[1], () => terminal(alpha, 'initial'));
    await check(cases[2], async () => {
      await start(beta); const other = await saved(beta); assert.notEqual(alpha.identity.uid, beta.identity.uid);
      const value = await domain(beta, other); assert.equal(other.execution.run.namespace, ''); assert.ok(value.listeners.length);
      await auth(beta); assert.equal(machines.get(fixture.vmId).forwards.length, 0);
      assert.ok(value.listeners.every((listener: any) => listener.process.uid.every((uid: number) => uid === beta.identity.uid)));
      return { session: other.execution, observation: value, noQemuForward: true };
    });
    await check(cases[3], async () => {
      await service.close(); const priorState = await pin(stateFile), priorJournal = await pin(join(setup.machine, 'project-identities', alpha.id + '.json'));
      const native = await core.runReadonly(fixture.vmId, alpha.identity, initial.execution.run.runId), startAt = proof.rootCommands.length;
      readonlyPhase = true;
      service = new browserModule.BrowserIde(machines, spaces, stateFile); await service.init();
      assert.equal((await inProject(alpha, () => service.view(fixture.vmId))).session.status, 'running'); await auth(alpha);
      assert.equal((await pin(stateFile)).sha256, priorState.sha256); assert.equal((await pin(priorJournal.path)).sha256, priorJournal.sha256);
      assert.deepEqual(await core.runReadonly(fixture.vmId, alpha.identity, native.runId), native);
      const commands = proof.rootCommands.slice(startAt); assert.ok(commands.length && commands.every((call: any) => !call.protectedFrame &&
        !['SAKURA_PROJECT_IDENTITY_INSTALL', 'SAKURA_PROJECT_SERVICE_PREPARE', 'SAKURA_PROJECT_SERVICE_START', 'SAKURA_PROJECT_SERVICE_COMMIT'].includes(call.action) &&
        !['prepare', 'exec-current'].includes(call.nativeAction))); readonlyPhase = false;
      return { stateUnchanged: true, journalUnchanged: true, nativeUnchanged: true, noInstallOrIssuance: true, commands: commands.length };
    });
    await check(cases[4], async () => {
      await service.close(); const original = await readFile(stateFile), hostJournal = await pin(join(setup.machine, 'project-identities', alpha.id + '.json'));
      const refusals: string[] = [];
      readonlyPhase = true;
      try {
        for (const kind of ['partial', 'changed-device', 'trailing-native-reply']) {
          const store = JSON.parse(original.toString()), row = store.sessions.find((value: any) => value.projectId === alpha.id);
          if (kind === 'partial') row.execution.run = null;
          if (kind === 'changed-device') row.execution.run.cgroupDevice = String(BigInt(row.execution.run.cgroupDevice) + 1n);
          await writeFile(stateFile, JSON.stringify(store, null, 2) + '\n'); const before = (await pin(stateFile)).sha256;
          service = new browserModule.BrowserIde(machines, spaces, stateFile);
          nativeReplyFault = kind === 'trailing-native-reply';
          let refused = false;
          try { await service.init(); await inProject(alpha, () => service.link(fixture.vmId)); }
          catch { refused = true; }
          assert.equal(refused, true, kind + ' was accepted'); nativeReplyFault = false;
          await service.close(); assert.equal((await pin(stateFile)).sha256, before);
          assert.equal((await pin(hostJournal.path)).sha256, hostJournal.sha256); refusals.push(kind);
        }
      } finally { nativeReplyFault = false; readonlyPhase = false; await writeFile(stateFile, original); service = new browserModule.BrowserIde(machines, spaces, stateFile); await service.init(); }
      await auth(alpha); return { refusals, hostJournalUnchanged: true };
    });
    await check(cases[5], async () => {
      await stop(alpha); const stopped = await assertStopped(alpha, initial); await auth(beta);
      assert.equal((await inProject(beta, () => service.view(fixture.vmId))).session.status, 'running');
      assert.equal((await domain(beta, await saved(beta))).listeners.length > 0, true); return { stopped, neighborStillRunning: true };
    });
    await check(cases[6], async () => {
      malformedFrame = { projectId: alpha.id, markerPath: alpha.directory + '/malformed-frame-' + invocation, mutated: false };
      try { await assert.rejects(() => start(alpha)); assert.equal(malformedFrame.mutated, true);
        const malformed = await entry(alpha, malformedFrame.runId!); assert.equal(malformed.phase, 'closed');
        const scope = '/sys/fs/cgroup/sakura-service-' + malformedFrame.runId;
        assert.equal((await machines.exec(fixture.vmId, 'test -e ' + quote(scope), 10000)).code !== 0, true);
        const probe = await machines.exec(fixture.vmId, 'ip netns exec sk-' + alpha.id + ' /usr/bin/python3 -I -S -c ' +
          quote('import socket\ns=socket.socket();s.settimeout(1);assert s.connect_ex(("127.0.0.1",8080))!=0'), 10000);
        assert.equal(probe.code, 0);
        assert.notEqual((await machines.exec(fixture.vmId, 'test -e ' + quote(malformedFrame.markerPath), 10000)).code, 0,
          'A malformed protected frame began executing project code');
        await auth(beta); return { fault: proof.frameFault, projectBodyMarkerAbsent: true,
          journalClosed: true, noListener: true, originalDomainAbsent: true };
      } finally { malformedFrame = undefined; }
    });
    await check(cases[7], async () => {
      await start(alpha, 1); await terminal(alpha, 'ttl'); const ttl = await saved(alpha); proof.ttlSession = ttl.execution;
      await service.close(); const hostBefore = await pin(join(setup.machine, 'project-identities', alpha.id + '.json'));
      const delayMs = Math.max(0, Date.parse(ttl.expiresAt) - Date.now());
      if (delayMs) await delay(delayMs);
      await waitFor(async () => (await domain(alpha, ttl)).domain === null, 'Guest TTL watchdog left its full domain populated', 45000);
      const value = await assertStopped(alpha, ttl, false); assert.equal((await entry(alpha, ttl.execution.run.runId)).phase, 'active');
      assert.equal((await pin(hostBefore.path)).sha256, hostBefore.sha256);
      return { guest: value, hostStillActive: true, hostJournalUnchangedWhileApplicationClosed: true, expiresAt: ttl.expiresAt };
    });
    await check(cases[8], async () => {
      const ttl = JSON.parse(await readFile(stateFile, 'utf8')).sessions.find((row: any) => row.projectId === alpha.id);
      service = new browserModule.BrowserIde(machines, spaces, stateFile); await service.init();
      await waitFor(async () => (await entry(alpha, ttl.execution.run.runId)).phase === 'closed', 'Expired reload did not retire original host receipt', 30000);
      await assertStopped(alpha, ttl); await auth(beta); return { oldRunId: ttl.execution.run.runId, hostClosed: true, neighborSurvives: true };
    });
    await stop(beta);
    await start(alpha); const old = await saved(alpha); await service.close();
    await check(cases[9], async () => {
      await machines.stop(fixture.vmId); await waitFor(() => children.size === 0, 'First owned QEMU did not close', 15000);
      assert.equal(exactQemu(setup.disk.path), 0); await machines.start(fixture.vmId);
      await waitFor(() => machines.state(fixture.vmId) !== 'starting', 'Cold boot failed', 300000); assert.equal(machines.state(fixture.vmId), 'running');
      const current = await observe({ operation: 'baseline' }); assert.notEqual(current.bootId, old.execution.run.bootId);
      service = new browserModule.BrowserIde(machines, spaces, stateFile); await service.init();
      const statePin = await pin(stateFile), journalPin = await pin(join(setup.machine, 'project-identities', alpha.id + '.json'));
      readonlyPhase = true;
      await assert.rejects(() => inProject(alpha, () => service.link(fixture.vmId)));
      assert.equal((await pin(stateFile)).sha256, statePin.sha256); assert.equal((await pin(journalPin.path)).sha256, journalPin.sha256);
      readonlyPhase = false;
      const stopAt = proof.rootCommands.length; await stop(alpha); const retired = await entry(alpha, old.execution.run.runId);
      assert.equal(retired.phase, 'closed'); assert.deepEqual(retired.retirement, { reason: 'guest-reboot', bootId: current.bootId });
      assert.ok(proof.rootCommands.slice(stopAt).every((call: any) => call.nativeAction !== 'stop'));
      await start(alpha); const fresh = await saved(alpha); assert.notEqual(fresh.execution.run.runId, old.execution.run.runId);
      assert.equal(fresh.execution.run.bootId, current.bootId); await auth(alpha); await stop(alpha); await assertStopped(alpha, fresh);
      return { original: old.execution.run, retirement: retired.retirement, newRun: fresh.execution.run, noNativeStopInNewBoot: true };
    });
    const after = await observe({ operation: 'baseline' });
    for (const line of baseline.passwd) assert.ok(after.passwd.includes(line), 'An original account changed');
    for (const line of baseline.group) assert.ok(after.group.includes(line), 'An original group changed');
    proof.originalAccountsPreserved = true;
  } catch (error) { proof.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  finally {
    nativeReplyFault = false; readonlyPhase = false; malformedFrame = undefined;
    scopeModule.ProjectBrowserIdeScope.prototype.start = originalStart; ProjectIdentities.prototype.install = originalInstall;
    const cleanup = async (name: string, work: () => Promise<unknown>) => {
      try { await work(); } catch (error) { proof.cleanupErrors.push({ name, error: error instanceof Error ? error.message : String(error) }); }
    };
    for (const browser of browsers) await cleanup('Owned Playwright close', () => browser.close());
    if (machines.state(fixture.vmId) === 'running') {
      // close() does not terminate the guest. A fresh owner handles only this
      // invocation's recorded projects; old fixture receipts are never adopted.
      await cleanup('Close prior Browser owner', () => service.close());
      service = new browserModule.BrowserIde(machines, spaces, stateFile);
      await cleanup('Recover owned Browser owner', () => service.init());
      for (const project of projects) await cleanup('Stop exact own project ' + project.id, () => stop(project));
      await cleanup('Every own host run retired', async () => {
        for (const project of projects) assert.ok((await journal(project)).runs.every((run: any) => run.phase === 'closed'));
        proof.ownedHostRunsClosed = true;
      });
      await cleanup('Restore active catalog selection', () => spaces.projects.update(fixture.vmId, setup.index.active));
    }
    await cleanup('Browser owner close', () => service.close()); await cleanup('Workspace close', () => spaces.close());
    await cleanup('Exact VM close', () => machines.close()); await cleanup('Owned direct Engine close', () => engine.runtime.close());
    machines.exec = originalExec; machines.execInput = originalInput;
    proof.vmStopped = machines.state(fixture.vmId) === 'stopped'; proof.liveEntries = machines.live.size; proof.ownedChildren = children.size;
    proof.ownedQemuSettled = proof.qemuExecutions.every((child: any) => child.exit && child.close && child.stdoutClosed && child.stderrClosed && child.settled);
    await cleanup('Independent exact QEMU inventory', async () => { proof.exactQemuMatches = exactQemu(setup.disk.path); assert.equal(proof.exactQemuMatches, 0); });
    await cleanup('Source freeze preservation', async () => { sameSources(await sourceSnapshot(setup.workspace, frozen.implementation), frozen.sourceSha256); proof.sourceUnchanged = true; });
    await cleanup('Original proof configs plans and receipts preservation', async () => {
      for (const [path, sha256] of Object.entries(setup.preserved)) assert.equal((await pin(path)).sha256, sha256, path);
      const index = JSON.parse(await readFile(join(setup.machine, 'projects.json'), 'utf8'));
      assert.equal(index.active, setup.index.active); for (const old of setup.index.projects) assert.deepEqual(index.projects.find((row: any) => row.id === old.id), old);
      const records = JSON.parse(await readFile(join(setup.root, 'machines.json'), 'utf8'));
      const stable = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'lastUsedAt'));
      assert.deepEqual(stable(records[0]), stable(setup.record)); assert.equal(records.length, 1);
      proof.originalHostEvidenceAndProjectsPreserved = true;
    });
    await cleanup('Final original owned disk pin', async () => { proof.finalDisk = await pin(setup.disk.path); });
    await cleanup('Readonly backing image preservation', async () => { assert.deepEqual(await pin(setup.base.path), setup.base); proof.originalBackingImageUnchanged = true; });
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === cases.length && proof.vmStopped &&
      proof.liveEntries === 0 && proof.ownedChildren === 0 && proof.ownedQemuSettled && proof.exactQemuMatches === 0;
    proof.finishedAt = new Date().toISOString(); await persist();
    await writeFile(join(ownHost, 'exit.json'), JSON.stringify({ invocation, proofFile, proofSha256: (await pin(proofFile)).sha256,
      passed: proof.passed, expectedExitCode: proof.passed ? 0 : 1,
      actualExitMustBeObservedByParent: true }) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ proof: proofFile, passed: proof.passed, vmStopped: proof.vmStopped,
      liveEntries: proof.liveEntries, ownedChildren: proof.ownedChildren, exactQemuMatches: proof.exactQemuMatches }));
  }
  process.exitCode = proof.passed ? 0 : 1;
}

async function waitFor(work: () => boolean | Promise<boolean>, message: string, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!await work()) { assert.ok(Date.now() < deadline, message); await delay(200); }
}
const args = process.argv.slice(2);
if (!args.length || args[0] === '--describe') {
  assert.ok(!args.length || args.length === 1);
  console.log(JSON.stringify({ version: 1, vmStarted: false, fixture, archiveSha256, cases,
    modes: ['--make-freeze ubuntu [source]', '--validate-only ubuntu <freeze.json>', '--run-owned ubuntu <freeze.json>'],
    default: 'describe only; never starts a VM', oldData: 'retained; two new UUID-scoped project directories and accounts',
    testOnlyStartup: 'owned multi-threaded TCG without icount; 3072 MiB guest; unchanged cloud readiness with 10 second SSH handshake budget' }, null, 2));
} else {
  assert.ok(args.length === 3 || args.length === 2 && args[0] === '--make-freeze'); assert.equal(args[1], 'ubuntu');
  assert.ok(['--make-freeze', '--validate-only', '--run-owned'].includes(args[0]));
  const setup = await validateOwned();
  if (args[0] === '--make-freeze') {
    assert.ok(args[2] === undefined || args[2] === 'source'); const implementation = 'source' as const;
    const source = await readFile(join(setup.workspace, 'server/browser-ide.ts'), 'utf8');
    assert.ok(source.includes('browserIdeSessionSchema') && source.includes('readonlyActive'), 'UID Browser implementation has not been prepared');
    const freezeDirectory = join(setup.workspace, '.data/browser-ide-uid-smoke-draft');
    await mkdir(freezeDirectory, { recursive: true }); assert.equal(await realpath(freezeDirectory), freezeDirectory);
    const file = join(freezeDirectory, 'freeze-' + randomUUID() + '.json');
    await writeFile(file, JSON.stringify({ version: 1, frozen: true, implementation, fixture: setup.root,
      vmId: fixture.vmId, archive: setup.archive, disk: setup.disk, base: setup.base,
      previousEvidence: setup.originalProof, previousClosedDiskEvidence: setup.previousClosedProof,
      sourceSha256: await sourceSnapshot(setup.workspace, implementation), createdAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ frozen: true, vmStarted: false, file }));
  } else {
    const freezeFile = await realpath(args[2]); assert.equal(dirname(freezeFile), join(setup.workspace, '.data/browser-ide-uid-smoke-draft'));
    assert.match(basename(freezeFile), /^freeze-[a-f0-9-]{36}\.json$/);
    const frozen = JSON.parse(await readFile(freezeFile, 'utf8'));
    assert.equal(frozen.version, 1); assert.equal(frozen.frozen, true); assert.equal(frozen.implementation, 'source');
    assert.equal(frozen.fixture, setup.root); assert.equal(frozen.vmId, fixture.vmId);
    assert.deepEqual(frozen.disk, setup.disk); assert.deepEqual(frozen.archive, setup.archive);
    assert.deepEqual(frozen.base, setup.base);
    assert.deepEqual(frozen.previousEvidence, setup.originalProof);
    assert.deepEqual(frozen.previousClosedDiskEvidence, setup.previousClosedProof);
    sameSources(frozen.sourceSha256, await sourceSnapshot(setup.workspace, frozen.implementation));
    if (args[0] === '--validate-only') console.log(JSON.stringify({ validated: true, vmStarted: false, fixture: setup.root,
      vmId: fixture.vmId, closedEvidence: setup.closedEvidence, archiveSha256, sourceFiles: Object.keys(frozen.sourceSha256).length,
      preservedHistoricalFiles: Object.keys(setup.preserved).length, plannedCases: cases.length }));
    else await runSmoke(setup, frozen);
  }
}
