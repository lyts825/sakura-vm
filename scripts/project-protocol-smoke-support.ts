import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from '../server/machines.ts';
import type { Features } from '../server/features.ts';
import type { ProjectIdentity } from '../server/project-identity.ts';
import type { ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';

const environment = 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const protocolSmokeObserver = String.raw`import glob,json,os,stat,sys
r=json.load(sys.stdin);run=r['run'];identity=r['identity']
assert set(r)=={'run','identity','marker','frameEnv','children'}
assert run['mode']=='inherit-current' and run['projectId']==identity['projectId']
assert run['cgroupName']=='sakura-task-'+run['runId']
def read(path,limit=131072):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  raise ValueError('observation bound')
 finally:os.close(fd)
def metadata(s):return {'device':str(s.st_dev),'inode':str(s.st_ino)}
def proc(pid):
 assert isinstance(pid,int) and pid>1
 path='/proc/'+str(pid)
 try:
  before=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[0] in (b'Z',b'X',b'x'):return None
  status=dict(row.split(':',1) for row in read(path+'/status',65536).decode().splitlines() if ':' in row)
  env=dict(row.split('=',1) for row in read(path+'/environ').decode().split('\0') if '=' in row)
  descriptors=[]
  for name in os.listdir(path+'/fd'):
   try:descriptors.append(os.readlink(path+'/fd/'+name))
   except (FileNotFoundError,ProcessLookupError):pass
  value={'pid':pid,'ticks':before[19].decode(),'session':int(before[3]),'uid':[int(v) for v in status['Uid'].split()],
   'gid':[int(v) for v in status['Gid'].split()],'groups':[int(v) for v in status['Groups'].split()],
   'home':env.get('HOME'),'user':env.get('USER'),'logname':env.get('LOGNAME'),
   'marker':env.get('SAKURA_PROTOCOL_UID_TEST'),'frameEnv':env.get('SAKURA_PROTOCOL_FRAME_ENV'),
   'cwd':os.readlink(path+'/cwd'),'scope':read(path+'/cgroup',4096).decode().strip(),
   'network':metadata(os.stat(path+'/ns/net')),'command':read(path+'/cmdline',65536).decode().replace('\0',' '),
   'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
   'authorityDescriptors':[value for value in descriptors if '/var/lib/sakura/project-identities' in value or
    '/run/sakura-guest-tasks/' in value or value.startswith('/sys/fs/cgroup/')]}
  after=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  assert before[19]==after[19] and after[0] not in (b'Z',b'X',b'x')
  return value
 except (FileNotFoundError,ProcessLookupError):return None
domain=None;members=[];reports=[]
path='/sys/fs/cgroup/'+run['cgroupName']
if os.path.lexists(path):
 for parent in ('/','/sys','/sys/fs','/sys/fs/cgroup',path):
  info=os.lstat(parent);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 domain=metadata(os.lstat(path));assert domain=={'device':run['cgroupDevice'],'inode':run['cgroupInode']}
 for file in glob.glob('/proc/[0-9]*/cgroup'):
  try:scope=read(file,4096).decode().strip()
  except (FileNotFoundError,ProcessLookupError):continue
  if scope=='0::/'+run['cgroupName'] or scope.startswith('0::/'+run['cgroupName']+'/'):
   value=proc(int(file.split('/')[2]))
   if value:members.append(value)
for name in os.listdir(identity['directory']):
 if not name.startswith('.protocol-probe-') or not name.endswith('.json'):continue
 path=identity['directory']+'/'+name;info=os.lstat(path)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==identity['uid'] and info.st_gid==identity['gid'] and info.st_nlink==1
 value=json.loads(read(path,65536))
 if value['marker']==r['marker'] and value['scope']=='0::/'+run['cgroupName']:reports.append(value)
children=[]
for child in r['children']:
 value=proc(child['pid']);children.append({'pid':child['pid'],'ticks':child['ticks'],
  'sameProcessAlive':bool(value and value['ticks']==child['ticks']),'process':value})
print(json.dumps({'bootId':read('/proc/sys/kernel/random/boot_id',128).decode().strip(),
 'domain':domain,'members':members,'reports':reports,'children':children,
 'controlPathPresent':os.path.lexists('/run/sakura-guest-tasks/'+run['runId'])}))
`;

// Known test code executes only through the public project's UID frame.
export const protocolLspProbe = String.raw`'use strict';
if (!process.env.SAKURA_PROTOCOL_PROBE_DONE) {
 process.env.SAKURA_PROTOCOL_PROBE_DONE = '1';
 const fs = require('node:fs'), cp = require('node:child_process');
 const child = cp.spawn('/bin/sleep', ['600'], { detached: true, stdio: 'ignore', env: { ...process.env } });
 child.unref();
 const status = Object.fromEntries(fs.readFileSync('/proc/self/status','utf8').split('\n').filter(v=>v.includes(':')).map(v=>[v.slice(0,v.indexOf(':')),v.slice(v.indexOf(':')+1).trim()]));
 const ticks = pid => fs.readFileSync('/proc/'+pid+'/stat','utf8').split(')').at(-1).trim().split(/\s+/)[19];
 const value = { pid:process.pid,ticks:ticks(process.pid),uid:process.getuid(),euid:process.geteuid(),
  gid:process.getgid(),egid:process.getegid(),groups:status.Groups?status.Groups.split(/\s+/).map(Number):[],home:process.env.HOME,cwd:process.cwd(),
  marker:process.env.SAKURA_PROTOCOL_UID_TEST,frameEnv:process.env.SAKURA_PROTOCOL_FRAME_ENV,
  scope:fs.readFileSync('/proc/self/cgroup','utf8').trim(),
  child:{pid:child.pid,ticks:ticks(child.pid)},caps:Object.fromEntries(['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs'].map(key=>[key,status[key]])) };
 fs.writeFileSync(process.cwd()+'/.protocol-probe-'+process.pid+'.json',JSON.stringify(value),{flag:'wx'});
}
`;

export const protocolDapProbe = String.raw`import json,os,subprocess
child=subprocess.Popen(['/bin/sleep','600'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
def ticks(pid):return open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19]
status=dict(row.split(':',1) for row in open('/proc/self/status') if ':' in row)
report={'pid':os.getpid(),'ticks':ticks(os.getpid()),'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'egid':os.getegid(),'groups':os.getgroups(),'home':os.environ['HOME'],'cwd':os.getcwd(),'marker':os.environ['SAKURA_PROTOCOL_UID_TEST'],'frameEnv':os.environ['SAKURA_PROTOCOL_FRAME_ENV'],'scope':open('/proc/self/cgroup').read().strip(),'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},'child':{'pid':child.pid,'ticks':ticks(child.pid),'session':os.getsid(child.pid)}}
with open('.protocol-probe-'+str(os.getpid())+'.json','x') as stream:json.dump(report,stream)
value = 1
value += 1
print(value)
print('PROTOCOL_UID_OUTPUT\x00'+os.environ['SAKURA_PROTOCOL_FRAME_ENV'])
`;
export const protocolDapBreakpoints = { initial: protocolDapProbe.split('\n').indexOf('value += 1') + 1,
  stepped: protocolDapProbe.split('\n').indexOf('print(value)') + 1 };

type Observation = { bootId: string; domain: { device: string; inode: string } | null;
  members: any[]; reports: any[]; children: { pid: number; ticks: string; sameProcessAlive: boolean; process: any }[]; controlPathPresent: boolean };
type Captured = { record: ProjectProtocolStreamRecord; active: Observation; children: { pid: number; ticks: string }[] };
export type ProtocolSmokeContext = { machines: Machines; features: Features; vmId: string; directory: string; identity: ProjectIdentity;
  marker: string; frameEnv: string; prove: (token: string, report: boolean) => Promise<void>;
  lsp: <T>(operation: () => Promise<T>) => Promise<T>; stopped: (token: string) => Promise<void> };

export function assertProtocolUidProcess(value: any, identity: ProjectIdentity, record: ProjectProtocolStreamRecord,
  marker: string, frameEnv: string) {
  assert.deepEqual(value.uid, [identity.uid, identity.uid, identity.uid, identity.uid]);
  assert.deepEqual(value.gid, [identity.gid, identity.gid, identity.gid, identity.gid]);
  assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home); assert.equal(value.user, identity.account);
  assert.equal(value.logname, identity.account); assert.equal(value.cwd, identity.directory);
  assert.equal(value.marker, marker); assert.equal(value.frameEnv, frameEnv);
  assert.equal(value.scope, '0::/' + record.run!.cgroupName);
  assert.deepEqual(value.network, { device: record.run!.networkDevice, inode: record.run!.networkInode });
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(value.caps[key], /^0+$/);
  assert.equal(value.caps.NoNewPrivs, '1'); assert.deepEqual(value.authorityDescriptors, []);
}
function exactQemu(disk: string) {
  if (process.platform !== 'win32') {
    const lines = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 15000 });
    return lines.split('\n').filter(line => /qemu-system/.test(line) && line.includes(disk)).length;
  }
  const source = '$request=[Console]::In.ReadToEnd()|ConvertFrom-Json;' +
    '[Console]::Write(@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {' +
    '($_.Name -eq "sakura-qemu.exe" -or $_.Name -like "qemu-system*.exe") -and $_.CommandLine -and $_.CommandLine.Contains($request.disk)}).Count)';
  const text = execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
    { input: JSON.stringify({ disk }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.match(text.trim(), /^[0-9]+$/); return Number(text.trim());
}

export async function withOwnedProtocolSmoke(kind: 'lsp' | 'dap', run: (context: ProtocolSmokeContext) => Promise<void>,
  prepare: (machines: Machines, vmId: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-' + kind + '-uid-smoke-')), invocation = randomUUID();
  const marker = kind + '-uid-' + invocation, frameEnv = 'protected UTF-8 春\nquote" apostrophe\' ' + invocation;
  const guestDirectory = '/srv/projects/protocol-' + invocation;
  const proofFile = join(directory, 'project-protocol-identity-evidence-' + invocation + '.json');
  const proof: any = { version: 1, invocation, kind, fixture: directory, marker, createdAt: new Date().toISOString(),
    guestDirectory, source: 'formal public service entry with real native launcher', runs: [], cleanupErrors: [],
    rootCommands: [], retained: true, passed: false };
  let proofQueue = Promise.resolve();
  const persist = () => { const bytes = JSON.stringify(proof, null, 2) + '\n';
    proofQueue = proofQueue.catch(() => {}).then(() => writeFile(proofFile, bytes)); return proofQueue; };
  await writeFile(join(directory, 'owned-fixture.json'), JSON.stringify({ version: 1, invocation, kind, directory,
    guestDirectory, proofFile, createdByThisInvocation: true, userInstance: false, retained: true }) + '\n', { flag: 'wx' });
  await persist();
  process.env.SAKURA_DATA_DIR = directory;
  process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
  process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
  const selected = process.env[kind === 'lsp' ? 'SAKURA_LSP_DISTRO' : 'SAKURA_DAP_DISTRO'] || 'alpine';
  assert.ok(['alpine', 'debian', 'ubuntu'].includes(selected));
  const distro = selected as 'alpine' | 'debian' | 'ubuntu', isolated = process.env[kind === 'lsp' ? 'SAKURA_LSP_PRIVATE' : 'SAKURA_DAP_PRIVATE'] === '1';
  proof.distro = distro; proof.isolated = isolated;
  let machines: Machines | undefined, features: Features | undefined, engine: Awaited<ReturnType<typeof import('../server/runtime.ts')['createRuntime']>> | undefined;
  let vmId: string | undefined, restoreOpen: (() => void) | undefined;
  let preparation: ProjectTerminals | undefined, prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
  let originalExec: Machines['exec'] | undefined, originalInput: Machines['execInput'] | undefined;
  const activeEngineRuns = new Set<object>(), owned = new Map<string, Captured>();
  try {
    const [{ Machines }, { createRuntime }, { Features }, { ProjectDirectoryMigrations }, identityModule,
      { ProjectRunScopes }, streamModule, { vmDir }] = await Promise.all([
      import('../server/machines.ts'), import('../server/runtime.ts'), import('../server/features.ts'),
      import('../server/project-directory-migration.ts'), import('../server/project-identity.ts'),
      import('../server/project-run-scope.ts'), import('../server/project-protocol-stream.ts'), import('../server/model.ts'),
    ]);
    engine = await createRuntime(); const originalRun = engine.run;
    engine.run = async (...args) => {
      const receipt = { tool: args[0], args: [...args[1]], startedAt: new Date().toISOString(), settled: false };
      activeEngineRuns.add(receipt); proof.engineRuns ||= []; proof.engineRuns.push(receipt); await persist();
      try { return await originalRun(...args); } finally { receipt.settled = true; activeEngineRuns.delete(receipt); await persist(); }
    };
    machines = new Machines(engine); await machines.init();
    assert.equal(machines.records.size, 0, 'A fresh owned fixture must contain no user VM');
    features = await Features.create(machines, ['code-checks']);
    const vm = await machines.create({ name: kind + '-uid-' + invocation.slice(0, 8), distro, memoryMiB: 2048, cpus: 2, diskGiB: 8,
      accelerator: (process.env.SAKURA_TEST_ACCELERATOR || 'auto') as 'auto' | 'tcg' | 'whpx' });
    vmId = vm.id; proof.vmId = vm.id; proof.machineDirectory = vmDir(vm.id); proof.disk = join(vmDir(vm.id), 'disk.qcow2'); await persist();
    await machines.start(vm.id); const deadline = Date.now() + 300000;
    while (machines.state(vm.id) !== 'running') {
      assert.ok(Date.now() < deadline && machines.state(vm.id) === 'starting', machines.logs.get(vm.id)); await delay(300);
    }
    const currentLive = machines.live.get(vm.id); assert.ok(currentLive);
    originalExec = machines.exec; originalInput = machines.execInput;
    machines.exec = async (...args) => { const row = { command: args[1], input: false }; proof.rootCommands.push(row);
      assert.ok(!args[1].includes(marker) && !args[1].includes(frameEnv), 'Project environment reached Root argv');
      return originalExec!.apply(machines!, args); };
    machines.execInput = async (...args) => { const row = { command: args[1], input: true, bytes: args[2].length,
      sha256: createHash('sha256').update(args[2]).digest('hex') }; proof.rootCommands.push(row);
      assert.ok(!args[1].includes(marker) && !args[1].includes(frameEnv), 'Project environment reached Root argv');
      return originalInput!.apply(machines!, args); };
    const made = await machines.exec(vm.id, 'mkdir -p /srv/projects; mkdir ' + quote(guestDirectory), 10000);
    assert.equal(made.code, 0, made.stderr);
    const preload = guestDirectory + '/owned-protocol-preload.cjs';
    if (kind === 'lsp') await machines.writeGuestFile(vm.id, preload, protocolLspProbe, false);
    await prepare(machines, vm.id, guestDirectory);
    await features.workspaces.save(vm.id, { directory: guestDirectory, template: 'none', repository: '', setup: '', command: '',
      networkIsolation: isolated ? 'private' : 'host', environment: { SAKURA_PROTOCOL_UID_TEST: marker,
        SAKURA_PROTOCOL_FRAME_ENV: frameEnv, ...(kind === 'lsp' ? { NODE_OPTIONS: '--require=' + preload } : {}) } });
    const migrations = new ProjectDirectoryMigrations(machines, features.workspaces);
    const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
    const applied = await migrations.apply(vm.id, { action: 'apply', version: 1, planId: preview.plan.proposal.planId,
      sha256: preview.plan.sha256, reviewed: true });
    assert.equal(applied.plan?.state, 'applied'); const identity = applied.plan!.activatedIdentity!;
    assert.ok(identity && identity.uid > 0 && identity.gid > 0 && identity.phase === 'active');
    assert.equal(identity.directory, guestDirectory); proof.identity = identity; proof.migration = applied.plan; await persist();
    if (isolated) {
      // Warm the fixed administrator namespace preparation before the short LSP
      // request timer. No main command, setup hook or project body executes here.
      const { ProjectTerminals } = await import('../server/project-terminals.ts');
      preparation = new ProjectTerminals(machines, features.workspaces);
      prepared = await preparation.prepare(vm.id, identity.projectId, null, false, undefined, undefined, { mode: 'task' });
      await prepared.release(); await preparation.close(); proof.fixedNamespacePrepared = true;
    }
    const core = new identityModule.ProjectIdentities(machines), scopes = new ProjectRunScopes(machines);
    const observe = async (record: ProjectProtocolStreamRecord, children: Captured['children']) => {
      assert.equal(machines!.live.get(vm.id), currentLive, 'Original owned live changed');
      const result = await machines!.execInput(vm.id, environment + '/usr/bin/python3 -I -S -c ' + quote(protocolSmokeObserver),
        Buffer.from(JSON.stringify({ identity, run: record.run, marker, frameEnv, children })), 10000);
      assert.equal(result.code, 0, result.stderr); assert.equal(machines!.live.get(vm.id), currentLive);
      return JSON.parse(result.stdout) as Observation;
    };
    const prove = async (token: string, report: boolean) => {
      const entry = owned.get(token); assert.ok(entry, 'No exact public UID admission observed');
      const native = await scopes.readonlyTask(vm.id, identity.projectId, token);
      assert.deepEqual(native.identity, identity); assert.equal(native.sha256, entry.record.sha256); assert.deepEqual(native.run, entry.record.run);
      let observation: Observation; const until = Date.now() + 10000;
      do { observation = await observe(entry.record, entry.children);
        if (observation.members.some(value => value.uid.every((uid: number) => uid === identity.uid)) && (!report || observation.reports.length)) break;
        assert.ok(Date.now() < until, 'UID adapter/report did not appear in original domain'); await delay(100);
      } while (true);
      assert.equal(observation.bootId, entry.record.bootId); assert.ok(observation.domain);
      for (const value of observation.members.filter(value => value.uid.every((uid: number) => uid === identity.uid)))
        assertProtocolUidProcess(value, identity, entry.record, marker, frameEnv);
      for (const value of observation.members.filter(value => value.uid.some((uid: number) => uid === 0))) {
        assert.notEqual(value.marker, marker); assert.ok(!value.command.includes(marker), 'Root relay received project body/env argv');
      }
      for (const value of observation.reports) {
        const originalProcess = observation.members.find(member => member.pid === value.pid && member.ticks === value.ticks);
        assert.ok(originalProcess, 'UID report must name a still-live original process');
        assertProtocolUidProcess(originalProcess, identity, entry.record, marker, frameEnv);
        assert.equal(value.uid, identity.uid); assert.equal(value.euid, identity.uid); assert.equal(value.gid, identity.gid);
        assert.equal(value.egid, identity.gid); assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home);
        assert.equal(value.cwd, guestDirectory); assert.equal(value.frameEnv, frameEnv); assert.equal(value.scope, '0::/' + entry.record.run!.cgroupName);
        for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(value.caps[key], /^0+$/);
        assert.equal(value.caps.NoNewPrivs, '1'); if ('session' in value.child) assert.equal(value.child.session, value.child.pid);
        if (!entry.children.some(child => child.pid === value.child.pid && child.ticks === value.child.ticks)) entry.children.push(value.child);
      }
      observation = await observe(entry.record, entry.children);
      if (report) { assert.ok(entry.children.length); assert.ok(observation.children.every(value => value.sameProcessAlive));
        for (const value of observation.children) { assertProtocolUidProcess(value.process, identity, entry.record, marker, frameEnv);
          assert.equal(value.process.session, value.pid, 'Expected own detached child session'); } }
      entry.active = observation; proof.runs = [...owned.values()]; await persist();
    };
    const stopped = async (token: string) => {
      const entry = owned.get(token); assert.ok(entry);
      const observation = await observe(entry.record, entry.children);
      assert.equal(observation.domain, null); assert.equal(observation.members.length, 0); assert.equal(observation.controlPathPresent, false);
      assert.ok(observation.children.every(value => !value.sameProcessAlive), 'Detached original PID+ticks survived whole-domain cleanup');
      const native = await core.runReadonly(vm.id, identity, token);
      assert.deepEqual(native, { ...entry.record.run, phase: 'closed' });
      const host = await scopes.taskRun(vm.id, identity.projectId, token);
      assert.equal(host?.phase, 'closed'); assert.equal(host.sha256, entry.record.sha256); assert.deepEqual(host.identity, identity);
      assert.deepEqual(host.run, native);
      const archived = streamModule.projectProtocolStreamSchema.parse(JSON.parse(await readFile(join(vmDir(vm.id), 'project-protocol-streams',
        identity.projectId, 'closed', token + '.json'), 'utf8')));
      assert.equal(archived.phase, 'closed'); assert.equal(archived.closure?.reason, 'scope-stopped'); assert.deepEqual(archived.run, entry.record.run);
      Object.assign(entry, { stopped: observation, closedNative: native, closedHost: host, closedProtocol: archived }); await persist();
    };
    const originalOpen = streamModule.ProjectProtocolStreams.prototype.open;
    streamModule.ProjectProtocolStreams.prototype.open = async function (...args) {
      assert.equal(args[0], vm.id); assert.equal(args[1], kind);
      const owner = await originalOpen.apply(this, args), record = owner.record();
      owned.set(record.runId, { record, active: undefined as never, children: [] }); proof.runs = [...owned.values()]; await persist();
      try { await prove(record.runId, kind === 'lsp'); return owner; }
      catch (error) { try { await owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Original UID observation/cleanup failed'); } throw error; }
    };
    restoreOpen = () => { streamModule.ProjectProtocolStreams.prototype.open = originalOpen; };
    const lsp = async <T>(operation: () => Promise<T>) => {
      const before = new Set(owned.keys()), result = await operation(), additions = [...owned.keys()].filter(token => !before.has(token));
      assert.equal(additions.length, 1, 'Public LSP request must own one exact full native run'); await stopped(additions[0]); return result;
    };
    await run({ machines, features, vmId: vm.id, directory: guestDirectory, identity, marker, frameEnv, prove, lsp, stopped });
    proof.publicProtocolCasesPassed = true;
  } catch (error) { proof.error = error instanceof Error ? error.stack : String(error); }
  finally {
    restoreOpen?.();
    const close = async (component: string, operation: () => Promise<unknown>) => {
      try { await operation(); } catch (error) { proof.cleanupErrors.push({ component, error: error instanceof Error ? error.stack : String(error) }); }
    };
    if (prepared) await close('Original namespace preparation lease', async () => prepared!.release());
    if (preparation) await close('Original namespace preparation owner', () => preparation!.close());
    if (features) {
      await close('LanguageServices', () => features!.languageServices.close());
      await close('DebugAdapter', () => features!.debugger.close());
      await close('Workspaces', () => features!.workspaces.close());
      await close('Features', () => features!.close());
    }
    if (machines) await close('Machines', () => machines!.close());
    if (engine) await close('RuntimeManager', () => engine!.runtime.close());
    if (machines && originalExec) machines.exec = originalExec;
    if (machines && originalInput) machines.execInput = originalInput;
    proof.vmStopped = !!vmId && machines?.state(vmId) === 'stopped'; proof.liveEntries = machines?.live.size ?? null;
    proof.pendingEngineRuns = activeEngineRuns.size;
    if (proof.disk) await close('Independent exact QEMU inventory', async () => { proof.exactQemuMatches = exactQemu(proof.disk); assert.equal(proof.exactQemuMatches, 0); });
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.publicProtocolCasesPassed && proof.vmStopped &&
      proof.liveEntries === 0 && proof.pendingEngineRuns === 0 && proof.exactQemuMatches === 0;
    proof.finishedAt = new Date().toISOString(); await persist();
    console.log(JSON.stringify({ proof: proofFile, fixture: directory, retained: true, passed: proof.passed,
      vmStopped: proof.vmStopped, liveEntries: proof.liveEntries, exactQemuMatches: proof.exactQemuMatches }));
  }
  if (!proof.passed) throw new Error('Owned protocol smoke failed; original fixture and complete tickets retained at ' + directory, { cause: proof.error });
}
