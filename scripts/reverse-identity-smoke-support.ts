import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import type { ProjectIdentity } from '../server/project-identity.ts';
import type { reverseTunnelSessionSchema } from '../server/reverse-tunnels.ts';
import type { z } from 'zod';

const clean = 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
type Session = z.infer<typeof reverseTunnelSessionSchema>;

// Fixed, administrator-owned test receiver. Its UID 0 process is deliberately
// observed separately and never counts as the project's UID broker.
export const reverseSmokeReceiver = String.raw`import os,socket,sys,threading
server=socket.socket();server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
server.bind(('127.0.0.1',8765));server.listen(8)
def serve(conn):
 try:
  data=b''
  while b'\n' not in data:
   part=conn.recv(65536)
   if not part:return
   data+=part
  mode,data=data.split(b'\n',1)
  if mode==b'who':conn.sendall((sys.argv[1]+'|'+os.readlink('/proc/self/ns/net')).encode())
  elif mode==b'binary':
   while True:
    part=conn.recv(65536)
    if not part:break
    data+=part
   conn.sendall(data)
  elif mode==b'hold':
   conn.sendall(b'ready\n')
   while True:
    data=conn.recv(65536)
    if not data:break
    conn.sendall(data)
 finally:conn.close()
while True:
 conn,_=server.accept();threading.Thread(target=serve,args=(conn,),daemon=True).start()
`;

// These helpers accept metadata through stdin. They never execute project
// paths, project environment, configuration, hooks, or broker command bodies.
export const reverseSmokeKernel = String.raw`import ctypes,fcntl,glob,hashlib,json,os,re,signal,stat,struct,subprocess,sys,time
r=json.load(sys.stdin)
assert re.fullmatch('[0-9a-f-]{36}',r['invocation'])
assert re.fullmatch('default|[0-9a-f]{16}',r['projectId'])
folder='/run/sakura-reverse-smoke/'+r['invocation'];script=folder+'/receiver.py'
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
def metadata(value):return {'device':str(value.st_dev),'inode':str(value.st_ino)}
def secure(path,private=False):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 if private:assert not info.st_mode&0o077
 return info
def proc(pid):
 assert isinstance(pid,int) and pid>1
 path='/proc/'+str(pid)
 try:
  before=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[0] in (b'Z',b'X',b'x'):return None
  status=dict(row.split(':',1) for row in read(path+'/status',65536).decode().splitlines() if ':' in row)
  env=dict(row.split('=',1) for row in read(path+'/environ').decode().split(chr(0)) if '=' in row)
  descriptors=[]
  for name in os.listdir(path+'/fd'):
   try:descriptors.append(os.readlink(path+'/fd/'+name))
   except (FileNotFoundError,ProcessLookupError):pass
  sockets=[]
  for row in read(path+'/net/tcp',1048576).decode().splitlines()[1:]:
   fields=row.split()
   if len(fields)>9 and fields[3]=='0A' and 'socket:['+fields[9]+']' in descriptors:
    sockets.append({'address':fields[1].split(':')[0],'port':int(fields[1].split(':')[1],16),'uid':int(fields[7]),'socketInode':fields[9]})
  value={'pid':pid,'ticks':before[19].decode(),'uid':[int(v) for v in status['Uid'].split()],
   'gid':[int(v) for v in status['Gid'].split()],'groups':[int(v) for v in status['Groups'].split()],
   'home':env.get('HOME'),'user':env.get('USER'),'logname':env.get('LOGNAME'),
   'marker':env.get('SAKURA_REVERSE_UID_TEST'),'frameEnv':env.get('SAKURA_REVERSE_FRAME_ENV'),
   'cwd':os.readlink(path+'/cwd'),'scope':read(path+'/cgroup',4096).decode().strip(),
   'network':metadata(os.stat(path+'/ns/net')),'networkLink':os.readlink(path+'/ns/net'),
   'command':read(path+'/cmdline',65536).decode().replace(chr(0),' '),'sockets':sockets,
   'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
   'authorityDescriptors':[item for item in descriptors if '/var/lib/sakura/project-identities' in item or
    '/run/sakura-reverse-tunnels/' in item or '/run/sakura-guest-tasks/' in item or item.startswith('/sys/fs/cgroup/')]
  }
  after=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  assert before[19]==after[19] and after[0] not in (b'Z',b'X',b'x')
  return value
 except (FileNotFoundError,ProcessLookupError):return None
boot=read('/proc/sys/kernel/random/boot_id',128).decode().strip()
if r['op']=='receiver-start':
 assert set(r)=={'op','invocation','projectId','sourceSha256'}
 secure('/run');secure('/run/sakura-reverse-smoke',True);secure(folder,True)
 info=os.lstat(script);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and info.st_nlink==1
 assert hashlib.sha256(read(script)).hexdigest()==r['sourceSha256']
 argv=['/usr/bin/python3','-I','-S',script,r['projectId']]
 if r['projectId']!='default':
  ip=next(path for path in ('/usr/sbin/ip','/usr/bin/ip','/sbin/ip','/bin/ip') if os.path.isfile(path))
  argv=[ip,'netns','exec','sk-'+r['projectId']]+argv
 child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
  env={'HOME':'/','USER':'root','LOGNAME':'root','PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','LC_ALL':'C'},start_new_session=True,close_fds=True)
 value=None
 for attempt in range(100):
  value=proc(child.pid)
  if value and any(s['address']=='0100007F' and s['port']==8765 for s in value['sockets']):break
  if child.poll() is not None:raise ValueError('owned root receiver exited')
  time.sleep(.1)
 assert value and any(s['address']=='0100007F' and s['port']==8765 for s in value['sockets'])
 print(json.dumps({'bootId':boot,'receiver':value}))
elif r['op']=='receiver-stop':
 assert set(r)=={'op','invocation','projectId','bootId','receiver'} and r['bootId']==boot
 original=r['receiver'];value=proc(original['pid'])
 def same(value):return value and value['ticks']==original['ticks']
 if same(value):
  assert value['uid']==[0]*4 and value['gid']==[0]*4 and value['network']==original['network'] and script in value['command']
  assert r['projectId'] in value['command'].split()
  os.kill(value['pid'],signal.SIGTERM)
  for attempt in range(30):
   if not same(proc(value['pid'])):break
   time.sleep(.1)
  if same(proc(value['pid'])):os.kill(value['pid'],signal.SIGKILL)
  for attempt in range(30):
   if not same(proc(value['pid'])):break
   time.sleep(.1)
 assert not same(proc(original['pid']))
 print(json.dumps({'bootId':boot,'stopped':True,'originalPid':original['pid'],'originalTicks':original['ticks']}))
elif r['op']=='observe':
 assert set(r)=={'op','invocation','projectId','session','processes'}
 row=r['session'];run=row['execution']['run'];record=row['execution']['record']
 assert run['mode']=='inherit-current' and run['projectId']==r['projectId'] and run['bootId']==boot
 assert run['cgroupName']=='sakura-service-'+run['runId']==record['scopeName']
 assert record['projectId']==r['projectId'] and run['cgroupInode']==record['inode']
 identity=row['execution']['identity'];locations={}
 for name in ('home','directory'):
  info=os.lstat(identity[name]);assert stat.S_ISDIR(info.st_mode) and info.st_uid==identity['uid'] and info.st_gid==identity['gid']
  locations[name]={**metadata(info),'uid':info.st_uid,'gid':info.st_gid,'mode':stat.S_IMODE(info.st_mode)}
 assert any(line.split()[3]=='/' and line.split()[4]=='/sys/fs/cgroup' and ' - cgroup2 ' in line for line in read('/proc/self/mountinfo',1048576).decode().splitlines())
 path='/sys/fs/cgroup/'+run['cgroupName'];domain=None;members=[]
 if os.path.lexists(path):
  for parent in ('/','/sys','/sys/fs','/sys/fs/cgroup',path):secure(parent)
  domain=metadata(os.lstat(path));assert domain=={'device':run['cgroupDevice'],'inode':run['cgroupInode']}
  for file in glob.glob('/proc/[0-9]*/cgroup'):
   try:scope=read(file,4096).decode().strip()
   except (FileNotFoundError,ProcessLookupError):continue
   if scope=='0::/'+run['cgroupName'] or scope.startswith('0::/'+run['cgroupName']+'/'):
    value=proc(int(file.split('/')[2]))
    if value:members.append(value)
 if run['namespace']:
  assert run['namespace']=='sk-'+r['projectId'];secure('/run');secure('/run/netns')
  namespace='/run/netns/'+run['namespace']
 else:namespace='/proc/1/ns/net'
 network=os.open(namespace,os.O_RDONLY|os.O_CLOEXEC)
 try:
  info=os.fstat(network);assert info.st_uid==0 and fcntl.ioctl(network,0xb703)==0x40000000
  assert metadata(info)=={'device':run['networkDevice'],'inode':run['networkInode']}
  assert ctypes.CDLL(None,use_errno=True).setns(network,0x40000000)==0
 finally:os.close(network)
 originalListenerPresent=False
 for line in read('/proc/self/net/tcp',1048576).decode().splitlines()[1:]:
  fields=line.split()
  if len(fields)>9 and fields[3]=='0A' and fields[9]==row['listener']['socketInode']:
   assert fields[1]=='0100007F:'+format(row['listener']['port'],'04X') and int(fields[7])==row['execution']['identity']['uid']
   originalListenerPresent=True
 guest='/run/sakura-reverse-tunnels/'+r['projectId'];owner=None;frame=None
 if os.path.lexists(guest+'/owner.json'):
  secure('/run');secure('/run/sakura-reverse-tunnels');secure(guest,True)
  info=os.lstat(guest+'/owner.json');assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o077 and info.st_nlink==1
  owner=json.loads(read(guest+'/owner.json',65536))
  assert {**owner,'phase':record['phase']}==record
 framePath=guest+'/input-'+run['runId']+'.bin'
 if os.path.lexists(framePath):
  info=os.lstat(framePath);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o077 and info.st_nlink==1
  header,data=read(framePath,135168).split(b'\n',1);header=json.loads(header)
  assert set(header)=={'version','bootId','runId','scopeName','inode','binding','fileDevice','fileInode','sha256','bytes'} and header['version']==1
  for key in ('bootId','runId','scopeName','inode','binding'):assert header[key]==record[key]
  assert header['fileDevice']==str(info.st_dev) and header['fileInode']==str(info.st_ino)
  assert header['bytes']==len(data) and header['sha256']==hashlib.sha256(data).hexdigest()==row['execution']['sha256']
  assert 32<len(data)<=131072 and data[:8]==b'SKIDP001'
  version,flags,size,count,scriptBytes,reserved=struct.unpack_from('<6I',data,8)
  assert version==1 and flags==0 and reserved==0 and size==len(data)-32 and count<=128 and 0<scriptBytes<=65536
  offset=32+scriptBytes;environment={}
  for item in range(count):
   keyBytes,valueBytes=struct.unpack_from('<2I',data,offset);offset+=8
   key=data[offset:offset+keyBytes].decode();offset+=keyBytes
   value=data[offset:offset+valueBytes].decode();offset+=valueBytes
   assert re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}',key) and key not in environment and chr(0) not in value
   environment[key]=value
  assert offset==len(data)
  frame={'header':header,'bytes':len(data),'sha256':header['sha256'],'version':version,'flags':flags,
   'marker':environment.get('SAKURA_REVERSE_UID_TEST'),'frameEnv':environment.get('SAKURA_REVERSE_FRAME_ENV')}
 processes=[]
 for original in r['processes']:
  value=proc(original['pid']);processes.append({'pid':original['pid'],'ticks':original['ticks'],'sameProcessAlive':bool(value and value['ticks']==original['ticks'])})
 print(json.dumps({'bootId':boot,'domain':domain,'members':members,'processes':processes,'owner':owner,'frame':frame,
  'originalListenerPresent':originalListenerPresent,'locations':locations}))
else:raise ValueError('unknown fixed smoke operation')
`;

export function assertReverseUidBroker(value: any, row: Session, marker: string, frameEnv: string) {
  const identity = row.execution!.identity, run = row.execution!.run!, listener = row.listener!;
  assert.deepEqual(value.uid, Array(4).fill(identity.uid)); assert.deepEqual(value.gid, Array(4).fill(identity.gid));
  assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home); assert.equal(value.cwd, identity.directory);
  assert.equal(value.user, identity.account); assert.equal(value.logname, identity.account);
  assert.equal(value.marker, marker); assert.equal(value.frameEnv, frameEnv);
  assert.equal(value.scope, '0::/' + run.cgroupName);
  assert.deepEqual(value.network, { device: run.networkDevice, inode: run.networkInode });
  assert.equal(value.pid, listener.pid); assert.equal(value.ticks, listener.startTicks);
  assert.deepEqual(value.sockets.filter((socket: any) => socket.socketInode === listener.socketInode),
    [{ address: '0100007F', port: listener.port, uid: identity.uid, socketInode: listener.socketInode }]);
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(value.caps[key], /^0+$/);
  assert.equal(value.caps.NoNewPrivs, '1'); assert.deepEqual(value.authorityDescriptors, []);
}

function exactQemu(disk: string) {
  if (process.platform !== 'win32') return execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 15000 })
    .split('\n').filter(line => /qemu-system/.test(line) && line.includes(disk)).length;
  const source = '$request=[Console]::In.ReadToEnd()|ConvertFrom-Json;' +
    '[Console]::Write(@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {' +
    '($_.Name -eq "sakura-qemu.exe" -or $_.Name -like "qemu-system*.exe") -and $_.CommandLine -and $_.CommandLine.Contains($request.disk)}).Count)';
  const value = execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
    { input: JSON.stringify({ disk }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.match(value.trim(), /^[0-9]+$/); return Number(value.trim());
}

export type ReverseSmokeContext = {
  machines: Machines; workspaces: Workspaces; vmId: string; alpha: string; beta: string;
  directories: Map<string, string>; namespaces: Map<string, string>;
  job: (project: string, mode: 'open' | 'close' | 'status', duration?: number, signal?: AbortSignal) => Promise<Record<string, any>>;
  prove: (project: string) => Promise<Session>; stopped: (row: Session) => Promise<void>;
  scope: <T>(project: string, action: () => Promise<T>) => Promise<T>;
  recordCase: (name: string, detail?: unknown) => Promise<void>;
};

export async function withOwnedReverseSmoke(distro: 'alpine' | 'debian' | 'ubuntu', run: (context: ReverseSmokeContext) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-reverse-uid-smoke-')), invocation = randomUUID();
  const marker = 'reverse-uid-' + invocation, frameEnv = 'protected 春\nquote" apostrophe\' ' + invocation;
  const proofFile = join(directory, 'reverse-identity-evidence-' + invocation + '.json');
  const proof: any = { version: 1, invocation, directory, distro, createdByThisInvocation: true, userInstance: false,
    retained: true, vmStarted: false, source: 'formal public ExtendedFeatures action with one durable tunnel owner',
    cases: [], identities: [], migrations: [], runs: [], receivers: [], jobs: [], rootCommands: [], cleanupErrors: [], passed: false };
  let writes = Promise.resolve();
  const persist = () => { const bytes = JSON.stringify(proof, null, 2) + '\n';
    writes = writes.catch(() => {}).then(() => writeFile(proofFile, bytes)); return writes; };
  await writeFile(join(directory, 'owned-fixture.json'), JSON.stringify({ version: 1, invocation, directory, proofFile,
    createdByThisInvocation: true, userInstance: false, retained: true }) + '\n', { flag: 'wx' }); await persist();
  process.env.SAKURA_DATA_DIR = directory;
  const images = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
  process.env.SAKURA_IMAGE_DIR = resolve('.data/images'); process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
  let machines: Machines | undefined, workspaces: Workspaces | undefined;
  let extended: InstanceType<typeof import('../server/extended-features.ts')['ExtendedFeatures']> | undefined;
  let engine: Awaited<ReturnType<typeof import('../server/runtime.ts')['createRuntime']>> | undefined;
  let vmId: string | undefined, live: object | undefined;
  let originalExec: Machines['exec'] | undefined, originalInput: Machines['execInput'] | undefined;
  const engineRuns = new Set<object>(), captured = new Map<string, any>();
  const holders: { projectId: string; bootId: string; receiver: any; stopped?: unknown }[] = [];
  let preparation: InstanceType<typeof import('../server/project-terminals.ts')['ProjectTerminals']> | undefined;
  let lease: Awaited<ReturnType<NonNullable<typeof preparation>['prepare']>> | undefined;
  let closeOriginal: (() => Promise<void>) | undefined, stopReceivers: (() => Promise<void>) | undefined;
  try {
    const [{ Machines }, { createRuntime }, { Workspaces }, { ExtendedFeatures }, { ProjectDirectoryMigrations },
      { ProjectTerminals }, identityModule, { ProjectRunScopes }, { ProjectReverseTunnelScope }, tunnelModule, { vmDir }] = await Promise.all([
      import('../server/machines.ts'), import('../server/runtime.ts'), import('../server/workspaces.ts'),
      import('../server/extended-features.ts'), import('../server/project-directory-migration.ts'), import('../server/project-terminals.ts'),
      import('../server/project-identity.ts'), import('../server/project-run-scope.ts'), import('../server/project-service-scope.ts'),
      import('../server/reverse-tunnels.ts'), import('../server/model.ts')]);
    engine = await createRuntime(); const engineRun = engine.run;
    engine.run = async (...args) => { const entry = { tool: args[0], args: [...args[1]], settled: false };
      engineRuns.add(entry); proof.engineRuns ||= []; proof.engineRuns.push(entry);
      try { return await engineRun(...args); } finally { entry.settled = true; engineRuns.delete(entry); await persist(); } };
    machines = new Machines(engine); await machines.init(); assert.equal(machines.records.size, 0, 'Fresh owned fixture contains a user VM');
    workspaces = new Workspaces(machines); extended = new ExtendedFeatures(machines, workspaces);
    const vm = await machines.create({ name: 'reverse-uid-' + invocation.slice(0, 8), distro, memoryMiB: 1024, cpus: 2, diskGiB: 4 });
    vmId = vm.id; proof.vmId = vm.id; proof.machineDirectory = vmDir(vm.id); proof.disk = join(vmDir(vm.id), 'disk.qcow2'); await persist();
    await machines.start(vm.id); proof.vmStarted = true; const deadline = Date.now() + 300000;
    while (machines.state(vm.id) !== 'running') { assert.ok(Date.now() < deadline && machines.state(vm.id) === 'starting', machines.logs.get(vm.id)); await delay(300); }
    live = machines.live.get(vm.id); assert.ok(live);
    originalExec = machines.exec; originalInput = machines.execInput;
    const audit = (command: string, input?: Buffer) => {
      for (const value of [marker, frameEnv, ...[...captured.values()].map(entry => entry.session.token).filter(Boolean)])
        assert.ok(!command.includes(value), 'Project broker body, secret or environment reached Root argv');
      proof.rootCommands.push({ command, input: !!input, ...(input ? { bytes: input.length, sha256: createHash('sha256').update(input).digest('hex') } : {}) });
    };
    machines.exec = (...args) => { audit(args[1]); return originalExec!.apply(machines!, args); };
    machines.execInput = (...args) => { audit(args[1], args[2]); return originalInput!.apply(machines!, args); };
    const tools = await machines.exec(vm.id, clean + '/bin/sh -ec ' + quote(
      'if ! command -v python3 >/dev/null || ! command -v tmux >/dev/null; then ' +
      'if command -v apk >/dev/null; then apk add --no-cache python3 tmux; ' +
      'else apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 tmux; fi; fi; ' +
      'test -x /usr/bin/python3 && test -x /usr/bin/tmux'), 180000);
    assert.equal(tools.code, 0, tools.stdout + tools.stderr); proof.fixedAdministratorDependencies = ['python3', 'tmux'];
    const root = '/srv/projects/reverse-' + invocation, holder = '/run/sakura-reverse-smoke/' + invocation;
    const made = await machines.exec(vm.id, clean + '/bin/sh -ec ' + quote('umask 022; mkdir -p /srv/projects; mkdir ' + quote(root) + '; ' +
      'umask 077; mkdir -p /run/sakura-reverse-smoke; chmod 700 /run/sakura-reverse-smoke; mkdir ' + quote(holder) + '; mkdir ' +
      ['host', 'alpha', 'beta'].map(name => quote(root + '/' + name)).join(' ')), 10000);
    assert.equal(made.code, 0, made.stderr); await machines.writeGuestFile(vm.id, holder + '/receiver.py', reverseSmokeReceiver, false);
    const directories = new Map<string, string>(), identities = new Map<string, ProjectIdentity>();
    const config = (name: string, isolated: boolean) => ({ directory: root + '/' + name, template: 'none', repository: '', setup: '', command: '',
      networkIsolation: isolated ? 'private' as const : 'host' as const,
      environment: { SAKURA_REVERSE_UID_TEST: marker, SAKURA_REVERSE_FRAME_ENV: frameEnv } });
    await workspaces.save(vm.id, config('host', false)); directories.set('default', root + '/host');
    const alpha = (await workspaces.projects.create(vm.id, 'Alpha', async () => { await workspaces!.save(vm.id, config('alpha', true)); })).active;
    const beta = (await workspaces.projects.create(vm.id, 'Beta', async () => { await workspaces!.save(vm.id, config('beta', true)); })).active;
    directories.set(alpha, root + '/alpha'); directories.set(beta, root + '/beta'); proof.projects = [...directories];
    const scope = <T>(project: string, action: () => Promise<T>) => workspaces!.projects.with(vm.id, project, action);
    const migrations = new ProjectDirectoryMigrations(machines, workspaces);
    for (const project of directories.keys()) await scope(project, async () => {
      const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
      const applied = await migrations.apply(vm.id, { action: 'apply', version: 1, planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
      assert.equal(applied.plan?.state, 'applied'); const identity = applied.plan!.activatedIdentity!;
      assert.equal(identity.projectId, project); assert.equal(identity.directory, directories.get(project)); assert.ok(identity.uid > 0 && identity.gid > 0);
      identities.set(project, identity); proof.identities.push(identity); proof.migrations.push(applied.plan); await persist();
      if (project !== 'default') {
        preparation = new ProjectTerminals(machines!, workspaces!);
        lease = await preparation.prepare(vm.id, project, null, false, undefined, undefined, { mode: 'task' });
        await lease.release(); lease = undefined; await preparation.close(); preparation = undefined;
      }
    });
    for (const key of ['uid', 'gid', 'home'] as const)
      assert.equal(new Set([...identities.values()].map(identity => identity[key])).size, 3, 'All three projects require independent ' + key);
    const ensureLive = () => { assert.equal(machines!.live.get(vm.id), live, 'Original owned VM live changed'); assert.equal(machines!.state(vm.id), 'running'); };
    const kernel = async (request: object) => { ensureLive(); const result = await machines!.execInput(vm.id,
      clean + '/usr/bin/python3 -I -S -c ' + quote(reverseSmokeKernel), Buffer.from(JSON.stringify({ invocation, ...request })), 15000);
      ensureLive(); assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); };
    stopReceivers = async () => {
      const errors: unknown[] = [];
      for (const holder of holders) if (!holder.stopped) try { holder.stopped = await kernel({ op: 'receiver-stop', projectId: holder.projectId,
        bootId: holder.bootId, receiver: { pid: holder.receiver.pid, ticks: holder.receiver.ticks, network: holder.receiver.network } }); }
      catch (error) { errors.push(error); }
      proof.receivers = holders; await persist(); if (errors.length) throw new AggregateError(errors, 'Own Root receivers cleanup not proven');
    };
    const namespaces = new Map<string, string>();
    for (const projectId of directories.keys()) {
      const result = await kernel({ op: 'receiver-start', projectId, sourceSha256: createHash('sha256').update(reverseSmokeReceiver).digest('hex') });
      assert.deepEqual(result.receiver.uid, [0, 0, 0, 0]); assert.deepEqual(result.receiver.gid, [0, 0, 0, 0]);
      assert.equal(result.receiver.marker, null); assert.equal(result.receiver.frameEnv, null);
      namespaces.set(projectId, result.receiver.networkLink); holders.push({ projectId, ...result });
      proof.receivers = holders; await persist();
    }
    const core = new identityModule.ProjectIdentities(machines), scopes = new ProjectRunScopes(machines);
    const sessionFile = join(directory, 'reverse-tunnels.json');
    const rows = async (): Promise<Session[]> => { try { const value = JSON.parse(await readFile(sessionFile, 'utf8'));
      assert.equal(value.version, 1); assert.deepEqual(Object.keys(value).sort(), ['sessions', 'version']);
      return value.sessions.map((row: unknown) => tunnelModule.reverseTunnelSessionSchema.parse(row));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } };
    const journalFile = (project: string) => join(vmDir(vm.id), 'project-identities', project + '.json');
    const observe = (row: Session, processes: any[]) => kernel({ op: 'observe', projectId: row.projectId, session: row, processes });
    const prove = async (project: string) => {
      ensureLive(); const row = (await rows()).find(row => row.projectId === project && row.vmId === vm.id); assert.ok(row);
      assert.equal(row.phase, 'running'); assert.ok(row.execution?.run && row.listener);
      assert.deepEqual(row.execution.identity, identities.get(project));
      for (const command of proof.rootCommands)
        assert.ok(!command.command.includes(row.token!), 'Original broker token/body reached Root argv during startup');
      const process = await scope(project, async () => new ProjectReverseTunnelScope(machines!, vm.id, await workspaces!.config(vm.id)));
      const files = [sessionFile, journalFile(project), process.receipt(), join(process.receipt(), '..', 'transport-' + row.execution.record.runId + '.json')];
      const before = await Promise.all(files.map(file => readFile(file)));
      const native = await core.runReadonly(vm.id, row.execution.identity, row.execution.record.runId);
      assert.deepEqual(native, row.execution.run); assert.equal(await scopes.readonlyActive(vm.id, project, native.runId), true);
      const state = await process.status(undefined, row.execution.sha256); assert.equal(state.status, 'running'); assert.deepEqual(state.record, row.execution.record);
      const originalHost = JSON.parse(before[1].toString()).runs.find((entry: any) => entry.runId === native.runId);
      assert.ok(originalHost); assert.deepEqual(originalHost.run, native); assert.equal(originalHost.phase, 'active');
      assert.equal(originalHost.owner.kind, 'service'); assert.equal(originalHost.sha256, row.execution.sha256);
      const observation = await observe(row, []); assert.equal(observation.bootId, native.bootId); assert.ok(observation.domain);
      assert.equal(observation.originalListenerPresent, true);
      const broker = observation.members.find((value: any) => value.pid === row.listener!.pid && value.ticks === row.listener!.startTicks);
      assert.ok(broker, 'Actual UID broker missing from original full native domain'); assertReverseUidBroker(broker, row, marker, frameEnv);
      assert.deepEqual(observation.owner, row.execution.record); assert.equal(observation.frame?.sha256, row.execution.sha256);
      assert.equal(observation.frame?.bytes, JSON.parse(before[3].toString()).bytes);
      assert.equal(observation.frame.version, 1); assert.equal(observation.frame.flags, 0);
      assert.equal(observation.frame.marker, marker); assert.equal(observation.frame.frameEnv, frameEnv);
      for (const holder of holders) assert.notEqual(broker.pid, holder.receiver.pid, 'Root test receiver was mistaken for the UID broker');
      for (const value of observation.members.filter((value: any) => value.uid.includes(0)))
        for (const secret of [marker, frameEnv, row.token!]) assert.ok(!value.command.includes(secret) && value.marker !== marker && value.frameEnv !== frameEnv);
      assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before, 'Readonly proofs changed durable ownership');
      const entry = { session: structuredClone(row), originalHost, active: observation,
        processes: observation.members.map((value: any) => ({ pid: value.pid, ticks: value.ticks })) };
      captured.set(row.execution.record.runId, entry); proof.runs = [...captured.values()]; await persist(); return row;
    };
    const stopped = async (row: Session) => {
      ensureLive(); const entry = captured.get(row.execution!.record.runId); assert.ok(entry);
      const observation = await observe(row, entry.processes); assert.equal(observation.domain, null); assert.equal(observation.members.length, 0);
      assert.equal(observation.originalListenerPresent, false);
      assert.ok(observation.processes.every((value: any) => !value.sameProcessAlive), 'Original PID/start ticks survived complete domain stop');
      assert.equal(observation.frame, null); assert.deepEqual(observation.owner, { ...row.execution!.record, phase: 'stopped' });
      const native = await core.runReadonly(vm.id, row.execution!.identity, row.execution!.record.runId);
      assert.deepEqual(native, { ...row.execution!.run, phase: 'closed' });
      const journal = JSON.parse(await readFile(journalFile(row.projectId), 'utf8'));
      const host = journal.runs.find((value: any) => value.runId === native.runId); assert.deepEqual(host, { ...entry.originalHost, phase: 'closed', run: native });
      assert.ok(!(await rows()).some(value => value.id === row.id), 'Closed original service remained in tunnel store');
      Object.assign(entry, { stopped: observation, closedNative: native, closedHost: host, nativeClosedBeforeVmShutdown: true });
      proof.runs = [...captured.values()]; await persist();
    };
    const job: ReverseSmokeContext['job'] = async (project, mode, duration = 300, signal) => {
      const view = await scope(project, () => extended!.action(vm.id, { action: 'run', featureId: 'reverse-tunnel',
        options: mode === 'open' ? { mode, guestPort: 8765, durationSeconds: duration } : { mode } }, signal)) as { key: string; id: string; projectId: string };
      assert.equal(view.projectId, project); await extended!.jobs.wait(view.key); const completed = extended!.jobs.view(view.key);
      proof.jobs.push(completed); await persist(); assert.equal(completed?.status, 'done', JSON.stringify(completed));
      return extended!.jobs.result(view.id);
    };
    closeOriginal = async () => {
      ensureLive(); const errors: unknown[] = [];
      for (const row of await rows()) try { await job(row.projectId, 'close');
        const entry = row.execution?.run && captured.get(row.execution.record.runId); if (entry) await stopped(entry.session);
      } catch (error) { errors.push(error); }
      for (const entry of captured.values()) if (!entry.nativeClosedBeforeVmShutdown) try { await stopped(entry.session); } catch (error) { errors.push(error); }
      for (const project of directories.keys()) try {
        const journal = JSON.parse(await readFile(journalFile(project), 'utf8'));
        assert.ok(journal.runs.every((entry: any) => entry.phase === 'closed'), 'Owned host task/service ticket remains unclosed');
      } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Original native/service domains have not all closed before VM shutdown');
      proof.completeNativeCleanupBeforeVmShutdown = true; await persist();
    };
    await run({ machines, workspaces, vmId: vm.id, alpha, beta, directories, namespaces, job, prove, stopped, scope,
      recordCase: async (name, detail) => { proof.cases.push({ name, detail, passed: true }); await persist(); } });
    proof.publicCasesPassed = true;
  } catch (error) { proof.error = error instanceof Error ? error.stack : String(error); }
  finally {
    const close = async (component: string, operation: () => Promise<unknown>) => {
      try { await operation(); } catch (error) { proof.cleanupErrors.push({ component, error: error instanceof Error ? error.stack : String(error) }); await persist(); }
    };
    if (machines && vmId && machines.state(vmId) === 'paused') await close('Restore original VM before native retirement', async () => {
      assert.equal(machines!.live.get(vmId!), live); await machines!.resume(vmId!); assert.equal(machines!.live.get(vmId!), live);
      proof.resumedOriginalBeforeCleanup = true;
    });
    if (closeOriginal) await close('Every original native/service domain before VM shutdown', closeOriginal);
    if (stopReceivers) await close('Every original Root test receiver', stopReceivers);
    if (lease) await close('Original namespace preparation lease', async () => lease!.release());
    if (preparation) await close('Original namespace preparation owner', () => preparation!.close());
    if (extended) await close('ExtendedFeatures jobs and sole tunnel owner', () => extended!.close());
    if (workspaces) await close('Workspaces', () => workspaces!.close());
    if (machines) await close('Machines', () => machines!.close());
    if (engine) await close('RuntimeManager', () => engine!.runtime.close());
    if (machines && originalExec) machines.exec = originalExec; if (machines && originalInput) machines.execInput = originalInput;
    proof.vmStopped = !!vmId && machines?.state(vmId) === 'stopped'; proof.liveEntries = machines?.live.size ?? null;
    proof.pendingEngineRuns = engineRuns.size;
    if (proof.disk) await close('Independent exact own QEMU inventory', async () => { proof.exactQemuMatches = exactQemu(proof.disk); assert.equal(proof.exactQemuMatches, 0); });
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.publicCasesPassed && proof.completeNativeCleanupBeforeVmShutdown &&
      proof.vmStopped && proof.liveEntries === 0 && proof.pendingEngineRuns === 0 && proof.exactQemuMatches === 0;
    proof.finishedAt = new Date().toISOString(); await persist();
    console.log(JSON.stringify({ proof: proofFile, fixture: directory, retained: true, passed: proof.passed,
      nativeCleanupBeforeVmShutdown: !!proof.completeNativeCleanupBeforeVmShutdown, vmStopped: proof.vmStopped,
      liveEntries: proof.liveEntries, exactQemuMatches: proof.exactQemuMatches }));
  }
  if (!proof.passed) throw new Error('Owned Reverse UID smoke failed; original fixture and complete evidence retained at ' + directory, { cause: proof.error });
}
