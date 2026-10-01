import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Project } from '../server/workspaces.ts';
import type { ProjectIdentity, ProjectIdentityRun } from '../server/project-identity.ts';

// This script never creates a VM or removes an old fixture. A separate farm
// stamp, not a historical runtime stamp, must be approved before actual use.
const fixtures = {
  alpine: { name: 'sakura-guest-task-Oky2Cx', id: '45bd380f-5274-4bd8-968e-e2cb7ece4d1b' },
  debian: { name: 'sakura-guest-task-i24quD', id: '645d78d1-2848-4665-b2c1-e47903525834' },
  ubuntu: { name: 'sakura-guest-task-dhGwI9', id: 'f7cf98e3-e839-4eae-a55c-a214a7bdf472' },
} as const;
const storageSummaryName = 'runtime-project-identity-final-summary-10a5bfce-5855-4c68-a570-5de8e845201a.json';
const alpinePair = {
  alpha: '110d83e57d1ff1b1', beta: 'ba739f4b664cb114',
  invocation: '82c9bc6c-a128-4af3-b857-a0a95c99fad4',
  proofSha256: '7c5352e70a9d0385f94835356da81292b00d8460469a571f93a6226f0e99b068',
};
const requiredSources = [
  'server/build-farm.ts', 'server/project-terminals.ts', 'server/project-run-scope.ts',
  'server/project-identity.ts', 'server/workspaces.ts', 'server/jobs.ts', 'server/guest-task.ts',
  'server/project-directory-migration.ts', 'server/project-execution.ts',
  'server/project-network-isolation.ts', 'server/secrets.ts', 'server/local-store.ts', 'server/runtime-config.ts',
  'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
];
const caseNames = [
  'owned-boot-and-original-account-baseline',
  'exact-project-pair-and-directory-authority',
  'real-build-farm-uid-staging-body-home-caps-and-private-network',
  'same-project-two-slots-have-real-overlapping-owned-descendants',
  'active-project-and-prepared-lease-guards-reject-rebinding',
  'cancel-one-slot-cleans-all-descendants-and-preserves-neighbor',
  'other-project-cannot-read-body-environment-or-script-descriptors',
  'cancel-second-slot-confirms-full-ticket-and-control-retirement',
  'subdirectory-keeps-original-project-binding-and-shell-exit-semantics',
  'split-secret-stdout-stderr-and-saved-results-are-redacted',
  'account-cleanup-unconfirmed-remains-error-and-protects-the-account',
  'original-account-recovery-closes-only-the-confirmed-owned-run',
  'farm-close-cleans-running-work-and-keeps-another-terminal-lease',
  'reloaded-results-do-not-replay-work-or-follow-the-active-project',
];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stageInitializePython = (child: string) => 'import json,os,stat\np=' + JSON.stringify(child) +
  '\nassert not os.path.lexists(p)\nos.mkdir(p,0o700)\n' +
  'fd=os.open(p+"/fixture.py",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)\nprint(json.dumps({"uid":os.getuid(),"created":p}))';
const stageChunkPython = (child: string, uid: number, expected: number, part: Buffer) =>
  'import base64,os,stat\np=' + JSON.stringify(child + '/fixture.py') + '\nfd=os.open(p,os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)\n' +
  'try:\n i=os.fstat(fd);assert stat.S_ISREG(i.st_mode) and i.st_uid==' + uid +
  ' and i.st_nlink==1 and i.st_size==' + expected + '\n data=base64.b64decode(' + JSON.stringify(part.toString('base64')) +
  ');assert os.write(fd,data)==len(data);os.fsync(fd)\nfinally:os.close(fd)';

// Application code is installed only by the real BuildFarm UID runner, in a
// newly created child directory. No project body is used as a root argv value.
const applicationPython = String.raw`import hashlib,json,os,re,signal,stat,sys,time
mode,label,body_hash,root_only=sys.argv[1:5]
assert re.fullmatch(r'[a-z][a-z0-9-]{0,40}',label)
base=os.path.dirname(os.path.abspath(__file__))
body=os.environ.get('BUILD_BODY','')
assert hashlib.sha256(body.encode()).hexdigest()==body_hash
def publish(suffix):
 status=dict(line.split(':',1) for line in open('/proc/self/status') if ':' in line)
 fields=open('/proc/self/stat').read().rsplit(') ',1)[1].split()
 denied=False
 try:
  fd=os.open(root_only+'/forbidden',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
 except PermissionError:denied=True
 ns=os.stat('/proc/self/ns/net')
 descriptors=[]
 for name in os.listdir('/proc/self/fd'):
  try:descriptors.append({'fd':int(name),'target':os.readlink('/proc/self/fd/'+name)})
  except FileNotFoundError:pass
 value={'version':1,'label':label,'suffix':suffix,'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),
  'groups':os.getgroups(),'pid':os.getpid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'ticks':fields[19],
  'home':os.environ.get('HOME'),'cwd':os.getcwd(),'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),
  'networkDevice':str(ns.st_dev),'networkInode':str(ns.st_ino),'cgroup':open('/proc/self/cgroup').read().strip(),
  'noNewPrivs':status['NoNewPrivs'].strip(),'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')},
  'rootWriteDenied':denied,'bodyPresent':True,'descriptors':descriptors}
 path=base+'/'+label+'-'+suffix+'.json';temporary=path+'.new'
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  data=json.dumps(value).encode();assert len(data)<16384
  assert os.write(fd,data)==len(data);os.fsync(fd)
 finally:os.close(fd)
 assert not os.path.lexists(path);os.rename(temporary,path)
 return value
if mode=='hang':
 for kind in (signal.SIGTERM,signal.SIGHUP):signal.signal(kind,signal.SIG_IGN)
 publish('leader')
 for suffix in ('newgroup','setsid','doublefork'):
  child=os.fork()
  if child==0:
   if suffix=='newgroup':os.setpgid(0,0)
   else:os.setsid()
   if suffix=='doublefork' and os.fork()!=0:os._exit(0)
   publish(suffix)
   while True:time.sleep(0.2)
  if suffix=='doublefork':os.waitpid(child,0)
 while True:time.sleep(0.2)
elif mode=='neighbor':
 pid,ticks,foreign_script=sys.argv[5:8]
 fields=open('/proc/'+pid+'/stat').read().rsplit(') ',1)[1].split()
 assert fields[19]==ticks and fields[0] not in ('X','Z')
 result=publish('leader')
 for name,path in (('environment','/proc/'+pid+'/environ'),('descriptors','/proc/'+pid+'/fd'),('script',foreign_script)):
  try:
   if name=='descriptors':os.listdir(path)
   else:
    with open(path,'rb') as stream:stream.read(131073)
   result[name+'Denied']=False
  except PermissionError:result[name+'Denied']=True
 result['foreignArgvContainsBody']=body.encode() in open('/proc/'+pid+'/cmdline','rb').read(65537)
 result['rootArgvContainsBody']=False
 for name in os.listdir('/proc'):
  if not name.isdigit():continue
  try:
   if os.stat('/proc/'+name).st_uid==0 and body.encode() in open('/proc/'+name+'/cmdline','rb').read(65537):
    result['rootArgvContainsBody']=True
  except (OSError,PermissionError):pass
 print(json.dumps(result))
elif mode=='secret':
 publish('leader');value=os.environ['FARM_SECRET'].encode();assert len(value)>12
 for descriptor in (1,2):
  os.write(descriptor,b'prefix:');time.sleep(0.3)
  for chunk in (value[:7],value[7:19],value[19:]):
   os.write(descriptor,chunk);time.sleep(0.35)
  os.write(descriptor,b':suffix\n');time.sleep(0.3)
elif mode=='once':print(json.dumps(publish('leader')))
else:raise RuntimeError('fixture mode')
`;

// Observation only: bounded ordinary-file reads, pinned boot/PID/start ticks,
// cgroup and namespace identities. It never signals, authorizes or edits runs.
const observerPython = String.raw`import base64,grp,hashlib,json,os,pwd,re,stat,sys
request=json.load(sys.stdin);operation=request['operation']
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
assert request.get('bootId',boot)==boot
def metadata(info):
 return {'device':str(info.st_dev),'inode':str(info.st_ino),'uid':info.st_uid,'gid':info.st_gid,
  'mode':stat.S_IMODE(info.st_mode),'links':info.st_nlink,'size':info.st_size}
def bounded(path,uid=None,limit=16384,mode=None):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  info=os.fstat(fd)
  assert stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=limit
  assert uid is None or info.st_uid==uid
  assert mode is None or stat.S_IMODE(info.st_mode)==mode
  data=os.read(fd,limit+1);assert len(data)<=limit
  assert metadata(info)==metadata(os.fstat(fd))
  return data,metadata(info)
 finally:os.close(fd)
def directory(path,uid=None,mode=None):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
 assert uid is None or info.st_uid==uid
 assert mode is None or stat.S_IMODE(info.st_mode)==mode
 return metadata(info)
def process(value):
 try:
  fields=open('/proc/'+str(value['pid'])+'/stat').read().rsplit(') ',1)[1].split()
  alive=fields[19]==value['ticks'] and fields[0] not in ('Z','X')
  result={'pid':value['pid'],'ticks':value['ticks'],'alive':alive,'state':fields[0]}
  if alive:
   result['uid']=os.stat('/proc/'+str(value['pid'])).st_uid
   result['cgroup']=open('/proc/'+str(value['pid'])+'/cgroup').read().strip()
   ns=os.stat('/proc/'+str(value['pid'])+'/ns/net')
   result.update(networkDevice=str(ns.st_dev),networkInode=str(ns.st_ino))
  return result
 except FileNotFoundError:return {'pid':value['pid'],'ticks':value['ticks'],'alive':False,'state':'absent'}
def control(run_id):
 assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',run_id)
 path='/run/sakura-guest-tasks/'+run_id
 if not os.path.lexists(path):return {'exists':False,'directory':path}
 result={'exists':True,'directory':path,'metadata':directory(path,0,0o700),'files':{}}
 for name in sorted(os.listdir(path)):
  assert name=='owner' or name.startswith('.sakura-job-'+run_id+'.')
  data,info=bounded(path+'/'+name,0,16384,0o600)
  result['files'][name]={'metadata':info,'sha256':hashlib.sha256(data).hexdigest()}
  if name=='owner':
   fields=data.decode('ascii').split();assert len(fields)==3 and fields[0]=='1' and fields[2]==boot
   assert re.fullmatch(r'[a-f0-9-]{36}',fields[1]);result['owner']={'version':1,'nonce':fields[1],'bootId':fields[2]}
 return result
def tree(path):
 info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 items={};count=0;total=0
 for current,dirs,files in os.walk(path,followlinks=False):
  for name in ['.']+sorted(dirs+files):
   item=current if name=='.' else current+'/'+name;value=os.lstat(item);relative=os.path.relpath(item,path)
   count+=1;assert count<=30000
   result=metadata(value)
   if stat.S_ISLNK(value.st_mode):result['target']=os.readlink(item)
   elif stat.S_ISDIR(value.st_mode):result['type']='directory'
   else:
    assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022
    assert value.st_size<=134217728
    fd=os.open(item,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
     assert (value.st_dev,value.st_ino)==(os.fstat(fd).st_dev,os.fstat(fd).st_ino)
     digest=hashlib.sha256();read=0
     while True:
      data=os.read(fd,262144)
      if not data:break
      read+=len(data);total+=len(data);assert read<=value.st_size and total<=268435456
      digest.update(data)
     assert read==value.st_size;result['sha256']=digest.hexdigest()
    finally:os.close(fd)
   items[relative]=result
 return {'path':path,'count':count,'bytes':total,'sha256':hashlib.sha256(json.dumps(items,sort_keys=True).encode()).hexdigest(),'root':metadata(info)}
if operation=='baseline':
 data,info=bounded('/var/lib/sakura/project-identities/registry.json',0,1048576,0o600)
 registry=json.loads(data);accounts={};bindings={};identity_files={}
 for uid,value in registry['reserved'].items():
  name='skp'+value['identityId'].replace('-','')[:24]
  try:entry=pwd.getpwnam(name)
  except KeyError:accounts[name]=None;continue
  assert entry.pw_uid==int(uid) and entry.pw_gid==int(uid)
  group=grp.getgrgid(entry.pw_gid)
  home=directory(entry.pw_dir) if os.path.lexists(entry.pw_dir) else None
  accounts[name]={'uid':entry.pw_uid,'gid':entry.pw_gid,'home':entry.pw_dir,'shell':entry.pw_shell,
   'group':group.gr_name,'members':group.gr_mem,'homeMetadata':home}
 for name in sorted(os.listdir('/var/lib/sakura/project-identities/projects')):
  value,details=bounded('/var/lib/sakura/project-identities/projects/'+name,0,16384,0o600)
  bindings[name]=hashlib.sha256(value).hexdigest()
 for path in request.get('readyPaths',[]):
  assert re.fullmatch(r'/opt/sakura-runtimes/(?:node-22[.]12[.]0|python-3[.]12[.]12|python-managed-[a-f0-9-]{36})',path)
  identity_files[path]=tree(path)
 receipts={}
 for name in ('node-22.12.0','python-3.12.12'):
  path='/var/lib/sakura/runtime-versions/'+name+'.json'
  try:
   value,details=bounded(path,0,1048576,0o600);receipts[path]={'metadata':details,'sha256':hashlib.sha256(value).hexdigest()}
  except FileNotFoundError:receipts[path]=None
 result={'bootId':boot,'reserved':registry['reserved'],'registryId':registry['registryId'],
  'accounts':accounts,'bindings':bindings,'readyTrees':identity_files,'readyReceipts':receipts}
elif operation=='markers':
 result={'bootId':boot,'reports':[],'complete':True}
 for path in request['paths']:
  try:data,info=bounded(path,request['uid'],16384,0o600)
  except FileNotFoundError:result['complete']=False;break
  value=json.loads(data);assert value['uid']==request['uid'] and value['bootId']==boot
  value['observed']=process(value);value['markerMetadata']=info;result['reports'].append(value)
elif operation=='scope':
 run=request['run'];assert run['bootId']==boot
 path='/sys/fs/cgroup/'+run['cgroupName'];assert run['cgroupName']=='sakura-task-'+run['runId']
 if os.path.lexists(path):
  info=directory(path);assert info['device']==run['cgroupDevice'] and info['inode']==run['cgroupInode']
  result={'bootId':boot,'cgroupExists':True,'metadata':info,'events':open(path+'/cgroup.events').read().strip()}
 else:result={'bootId':boot,'cgroupExists':False}
 result['processes']=[process(value) for value in request.get('reports',[])]
 result['control']=control(run['runId'])
elif operation=='root-argv':
 needles=[value.encode() for value in request['needles']];matches=[]
 for name in os.listdir('/proc'):
  if not name.isdigit():continue
  try:
   if os.stat('/proc/'+name).st_uid!=0:continue
   data=open('/proc/'+name+'/cmdline','rb').read(131073)
   if any(needle in data for needle in needles):matches.append(int(name))
  except OSError:pass
 result={'bootId':boot,'matchingRootPids':matches}
elif operation=='paths':
 result={'bootId':boot,'paths':{}}
 for path in request['paths']:
  if not os.path.lexists(path):result['paths'][path]=None;continue
  data,info=bounded(path,request.get('uid'),1048576)
  result['paths'][path]={'metadata':info,'sha256':hashlib.sha256(data).hexdigest()}
elif operation=='namespace':
 result={'bootId':boot,'host':metadata(os.stat('/proc/self/ns/net')),
  'private':metadata(os.stat('/run/netns/sk-'+request['projectId']))}
else:raise RuntimeError('observer operation')
print(json.dumps(result))
`;

const bootstrapPython = String.raw`import json,os,stat,sys
request=json.load(sys.stdin)
root_only=request['rootOnly'];assert root_only.startswith('/run/sakura-owned-farm-')
assert not os.path.lexists(root_only);os.mkdir(root_only,0o700)
assert os.lstat(root_only).st_uid==0
if request['newProjects']:
 base=request['base'];assert base.startswith('/workspace/build-farm-')
 ancestor=os.lstat('/workspace');assert stat.S_ISDIR(ancestor.st_mode) and not stat.S_ISLNK(ancestor.st_mode)
 assert not os.path.lexists(base);os.mkdir(base,0o755)
 fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(fd);assert info.st_uid==0 and info.st_gid==0
  os.fchmod(fd,0o755)
 finally:os.close(fd)
 for suffix in ('alpha','beta'):os.mkdir(base+'/'+suffix,0o700)
print(json.dumps({'rootOnly':root_only,'createdProjectRoots':request['newProjects']}))
`;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--check-fixture') {
  const initialized = stageInitializePython('/workspace/build-farm-static/alpha/build-farm-static');
  const append = stageChunkPython('/workspace/build-farm-static/alpha/build-farm-static', 20001, 1400, Buffer.alloc(1400, 'x'));
  const result = spawnSync('python', ['-I', '-S', '-c',
    'import ast,json,sys\nv=json.load(sys.stdin)\nfor name,source in v.items():ast.parse(source,filename=name)\nprint(json.dumps({"parsed":sorted(v)}))'],
  { input: JSON.stringify({ application: applicationPython, observer: observerPython, bootstrap: bootstrapPython,
    stageInitialize: initialized, stageChunk: append }),
    encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const sample = "cd './new-child' || exit 72\nfalse; true";
  assert.equal(sample.includes('set -e'), false);
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  for (const source of [initialized, append]) assert.ok(('/usr/bin/python3 -I -S -c ' + shellQuote(source)).length < 4096);
  assert.equal(/^build-farm-identity-freeze-[a-f0-9-]{36}\.json$/.test('runtime-identity-freeze-f321f9eb-0129-4cdc-b3a8-ee8eede8b64d.json'), false);
  assert.ok(requiredSources.includes('server/build-farm.ts'));
  console.log(JSON.stringify({ staticOnly: true, ...JSON.parse(result.stdout),
    plannedCases: { alpine: caseNames.filter(name => !name.startsWith('split-secret')).length,
      debian: caseNames.length, ubuntu: caseNames.length },
    boundary: 'Syntax and harness contracts only; no Linux result, VM or production execution.' }, null, 2));
} else {
  assert.ok(args.length === 3 || (args.length === 4 && args[3] === '--validate-only'),
    'Use node --import tsx scripts/smoke-build-farm-identity.ts <alpine|debian|ubuntu> <exact-owned-stopped-fixture> <build-farm-identity-freeze-UUID.json> [--validate-only].');
  const [distroInput, fixtureInput, stampInput] = args;
  assert.ok(Object.hasOwn(fixtures, distroInput));
  const distro = distroInput as keyof typeof fixtures, selected = fixtures[distro];
  assert.equal(process.platform, 'win32');
  assert.deepEqual(process.execArgv, ['--import', 'tsx'], 'Use the actual default Node/tsx client, without --no-addons or a substitute runtime.');
  assert.equal(process.env.NODE_OPTIONS || '', '');
  const workspace = await realpath(resolve('.'));
  assert.match(workspace, /^[dD]:\\/);
  const parent = await realpath(join(workspace, '.data', 'network-remaining-test-temp'));
  const root = await realpath(resolve(fixtureInput));
  assert.equal(dirname(root), parent); assert.equal(basename(root), selected.name);
  const freezeFile = await realpath(resolve(stampInput));
  assert.equal(dirname(freezeFile), parent);
  assert.match(basename(freezeFile), /^build-farm-identity-freeze-[a-f0-9-]{36}\.json$/,
    'Historical runtime stamps do not authorize farm execution.');
  const freezeBytes = await readFile(freezeFile), freeze = JSON.parse(freezeBytes.toString());
  assert.equal(freeze.version, 1); assert.equal(freeze.frozen, true);
  assert.match(freeze.scriptSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(hash(await readFile(join(workspace, 'scripts', 'smoke-build-farm-identity.ts'))), freeze.scriptSha256,
    'The smoke script differs from the script explicitly approved by this farm freeze.');
  for (const source of requiredSources) assert.match(freeze.sourceSha256?.[source] || '', /^[a-f0-9]{64}$/);
  for (const [source, expected] of Object.entries(freeze.sourceSha256) as [string, string][]) {
    assert.match(source, /^(server|plugins|native|shared|src)\/[A-Za-z0-9/_.-]+$/);
    assert.ok(source.split('/').every(part => part && !['.', '..'].includes(part)));
    assert.match(expected, /^[a-f0-9]{64}$/);
    assert.equal(hash(await readFile(join(workspace, source))), expected, 'Source changed: ' + source);
  }
  const assetDirectory = join(workspace, '.sakura-server', 'assets', 'project-identity');
  const manifest = JSON.parse(await readFile(join(assetDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.files.map((value: any) => value.name), ['protocol.h', 'launcher.c', 'controller.py']);
  const aggregate = createHash('sha256');
  for (const entry of manifest.files) {
    const bytes = await readFile(join(assetDirectory, entry.name));
    assert.equal(bytes.length, entry.size); assert.equal(hash(bytes), entry.sha256);
    assert.equal(entry.sha256, freeze.sourceSha256['native/project-identity/' + entry.name]);
    aggregate.update(entry.name); aggregate.update(bytes);
  }
  assert.equal(aggregate.digest('hex'), manifest.build);
  const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.equal(records.length, 1); const record = records[0];
  assert.equal(record.id, selected.id); assert.equal(record.distro, distro);
  assert.equal(record.name, 'guest-task-cgroup-smoke'); assert.equal(record.bootstrapped, true);
  assert.ok(!record.template || record.template === 'none', 'The reused fixture must not auto-run an old template setup.');
  assert.deepEqual(record.forwards || [], []); assert.deepEqual(record.snapshots || [], []);
  for (const key of ['sandbox', 'storagePoolId', 'haPromotion', 'haRetirement', 'lastError', 'rescueOf'])
    assert.equal(record[key], undefined);
  const vmId = selected.id, machineDirectory = await realpath(join(root, 'machines', vmId));
  const diskFile = join(machineDirectory, 'disk.qcow2');
  assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
  assert.equal(await realpath(diskFile), diskFile);
  assert.ok((await lstat(diskFile)).isFile()); assert.equal((await lstat(diskFile)).isSymbolicLink(), false);
  for (const path of [parent, root, machineDirectory]) assert.equal((await lstat(path)).isSymbolicLink(), false);
  const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$r='" + root.replaceAll("'", "''") + "';$v='" + vmId + "';@(" +
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) }).Count"],
  { encoding: 'utf8', windowsHide: true }).trim());
  assert.equal(exactQemu(), 0, 'The exact owned fixture is already running.');
  const historicalFiles: { file: string; sha256: string }[] = [];
  const remember = async (file: string, expected?: string) => {
    const resolved = await realpath(file), info = await lstat(resolved);
    assert.ok(info.isFile()); assert.ok(info.size <= 16 * 1024 * 1024);
    const bytes = await readFile(resolved); if (expected) assert.equal(hash(bytes), expected);
    if (!historicalFiles.some(value => value.file === resolved)) historicalFiles.push({ file: resolved, sha256: hash(bytes) });
    return JSON.parse(bytes.toString());
  };
  const storage = await remember(join(parent, storageSummaryName));
  assert.equal(storage.status, 'passed'); assert.equal(storage.proofs.length, 3);
  for (const entry of storage.proofs) {
    assert.ok(Object.values(fixtures).some(fixture => entry.vmId === fixture.id));
    await remember(entry.file, entry.fileSha256);
  }
  const priorEntry = storage.proofs.find((value: any) => value.distro === distro);
  assert.ok(priorEntry); assert.equal(priorEntry.fixture, root); assert.equal(priorEntry.vmId, vmId);
  assert.equal(priorEntry.vmStopped, true); assert.equal(priorEntry.liveEntries, 0);
  const prior = await remember(priorEntry.file, priorEntry.fileSha256);
  assert.equal(prior.passed, true); assert.equal(prior.vmStopped, true); assert.equal(prior.exactQemuMatches, 0);
  assert.equal(prior.fixture, root); assert.equal(prior.vmId, vmId);
  for (const file of [join(parent, 'project-uid-scopes-final-summary.json'),
    join(parent, 'project-uid-migration-overlap-final-summary.json')]) {
    const summary = await remember(file); assert.equal(summary.status, 'passed');
    assert.equal(summary.proofs.length, 3);
    assert.equal(new Set(summary.proofs.map((value: any) => value.distro)).size, 3);
    const isScopes = basename(file) === 'project-uid-scopes-final-summary.json';
    const expectedCases = isScopes ? 18 : 3;
    for (const value of summary.proofs) {
      assert.ok(Object.hasOwn(fixtures, value.distro));
      const historicalFixture = fixtures[value.distro as keyof typeof fixtures];
      const historicalRoot = await realpath(join(parent, historicalFixture.name));
      assert.equal(historicalRoot, join(parent, historicalFixture.name));
      assert.equal(dirname(resolve(value.file)), historicalRoot);
      const historicalProofFile = await realpath(value.file);
      assert.equal(dirname(historicalProofFile), historicalRoot);
      const prefix = isScopes
        ? 'project-uid-scopes-evidence-' : 'project-uid-migration-overlap-evidence-';
      assert.ok(basename(historicalProofFile).startsWith(prefix));
      assert.match(basename(historicalProofFile).slice(prefix.length), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/);
      assert.match(value.fileSha256, /^[a-f0-9]{64}$/);
      const historicalProof = await remember(historicalProofFile, value.fileSha256);
      assert.equal(historicalProof.distro, value.distro);
      assert.equal(historicalProof.vmId, historicalFixture.id);
      assert.equal(historicalProof.fixture, historicalRoot);
      assert.equal(historicalProof.vmStopped, true); assert.equal(historicalProof.liveEntries, 0);
      assert.equal(historicalProof.ownedQemuSettled, true);
      assert.equal(value.vmStopped, true); assert.equal(value.liveEntries, 0);
      assert.equal(value.ownedQemuSettled, true); assert.equal(value.exactQemuMatches, 0);
      assert.equal(value.cases, expectedCases);
      assert.ok(Array.isArray(historicalProof.cases));
      assert.equal(historicalProof.cases.length, expectedCases);
      assert.equal(new Set(historicalProof.cases.map((item: any) => item.name)).size, expectedCases);
      for (const item of historicalProof.cases) {
        assert.equal(typeof item.name, 'string'); assert.ok(item.name.length > 0);
        assert.ok(Number.isFinite(Date.parse(item.startedAt)) && Number.isFinite(Date.parse(item.finishedAt)));
        assert.ok(Date.parse(item.finishedAt) >= Date.parse(item.startedAt));
        for (const key of ['error', 'failedCase', 'failure', 'failed']) assert.equal(Object.hasOwn(item, key), false);
      }
      for (const key of ['error', 'failedCase', 'failure', 'failed']) assert.equal(Object.hasOwn(historicalProof, key), false);
      if (isScopes) {
        // The original 54-case proofs have no passed or exactQemuMatches fields.
        assert.equal(historicalProof.rootArgvBodyAbsent, true);
      } else {
        assert.equal(historicalProof.passed, true);
        assert.equal(historicalProof.exactQemuMatches, 0);
        assert.deepEqual(historicalProof.cleanupErrors, []);
      }
      if (value.vmId !== undefined) assert.equal(value.vmId, historicalProof.vmId);
    }
  }
  // Preserve all old positive AND negative top-level proofs and diagnostics.
  // machines.json is operational metadata; the exact record is separately fixed.
  for (const name of await readdir(root)) if (name.endsWith('.json') && name !== 'machines.json')
    await remember(join(root, name));
  if (distro === 'alpine') {
    assert.equal(hash(await readFile(priorEntry.file)), alpinePair.proofSha256);
    assert.equal(prior.invocation, alpinePair.invocation);
    for (const id of [alpinePair.alpha, alpinePair.beta]) assert.ok(prior['closed-' + id]);
  }
  if (args[3] === '--validate-only') {
    console.log(JSON.stringify({ validated: true, vmStarted: false, fixture: root, vmId,
      freezeSha256: hash(freezeBytes), historicalFiles: historicalFiles.length,
      plannedCases: distro === 'alpine' ? 13 : 14 }, null, 2));
  } else {
    await runSmoke({ workspace, parent, root, machineDirectory, vmId, distro, record,
      freezeFile, freezeBytes, freeze, historicalFiles, prior, exactQemu });
  }
}

type Setup = { workspace: string; parent: string; root: string; machineDirectory: string; vmId: string;
  distro: keyof typeof fixtures; record: any; freezeFile: string; freezeBytes: Buffer; freeze: any;
  historicalFiles: { file: string; sha256: string }[]; prior: any; exactQemu: () => number };

async function runSmoke(setup: Setup) {
  const { workspace, parent, root, machineDirectory, vmId, distro, freezeFile, freezeBytes, freeze,
    historicalFiles, prior, exactQemu } = setup;
  const invocation = randomUUID(), bodyCanary = 'farm-protected-body-' + invocation;
  const secretCanary = 'farm-private-secret-' + randomUUID();
  const mask = (value: unknown) => String(value).replaceAll(bodyCanary, '[owned body]').replaceAll(secretCanary, '[owned secret]');
  const scriptFile = join(workspace, 'scripts', 'smoke-build-farm-identity.ts');
  const proofFile = join(root, 'build-farm-identity-evidence-' + invocation + '.json');
  const logFile = join(parent, 'build-farm-identity-' + distro + '-' + invocation + '.log');
  const exitFile = join(parent, 'build-farm-identity-' + distro + '-' + invocation + '-exit.json');
  const hostScope = join(root, 'build-farm-owned-' + invocation);
  const rootOnly = '/run/sakura-owned-farm-' + invocation, base = '/workspace/build-farm-' + invocation;
  const proof: any = { version: 1, invocation, fixture: root, vmId, distro, passed: false, phase: 'initializing',
    startedAt: new Date().toISOString(), client: { node: process.version, pid: process.pid, execArgv: process.execArgv,
      noAddonsRequested: false }, frozenStamp: { file: freezeFile, sha256: hash(freezeBytes) },
    sourceSha256: freeze.sourceSha256, scriptSha256: hash(await readFile(scriptFile)), cases: [],
    expectedCases: distro === 'alpine' ? 13 : 14, logFile, exitFile, hostScope,
    scope: 'Guarded source BuildFarm/Jobs/ProjectTerminals/Workspaces; not the old fresh 8GiB VM smoke or compiled HTTP.',
    fixtureMode: distro === 'alpine' ? 'previously migrated exact projects; only new UID child directories' : 'two new reviewed and applied owned projects',
    secretsDriver: distro === 'alpine' ? 'Not executed: pinned unchanged configurations have no secret references.' : 'Real independent DPAPI Secrets store and saved references in new owned projects.',
    cleanupFaultBoundary: 'Only the exact new run account-stop connection is blocked; real outer cgroup cleanup remains enabled.',
    previousEvidence: { files: historicalFiles, attribution: 'Original proof source maps and client flags remain their original evidence.' },
    retainedGuestPaths: [], qemuExecutions: [] };
  const log = await open(logFile, 'wx');
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  process.once('exit', code => writeFileSync(exitFile, JSON.stringify({ version: 1, invocation, actualExitCode: code,
    client: proof.client, proofFile, logFile, at: new Date().toISOString() }) + '\n', { flag: 'wx' }));
  const persist = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  const line = async (value: string) => { const text = mask(value) + '\n'; await log.write(text); console.log(text.trimEnd()); };
  const check = async (name: string, action: () => Promise<unknown>) => {
    assert.ok(caseNames.includes(name)); proof.activeCase = { name, startedAt: new Date().toISOString() }; await persist();
    try {
      const evidence = await action(); proof.cases.push({ ...proof.activeCase, finishedAt: new Date().toISOString(), evidence });
      delete proof.activeCase; await persist(); await line('PASS ' + distro + ' ' + name);
    } catch (error) { proof.failedCase = { ...proof.activeCase, error: mask(error), failedAt: new Date().toISOString() }; await persist(); throw error; }
  };
  process.env.TEMP = process.env.TMP = parent;
  process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
  process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images',
    { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]);
  const { Machines } = await import('../server/machines.ts');
  const { createRuntime } = await import('../server/runtime.ts');
  const { BuildFarm } = await import('../server/build-farm.ts');
  const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
  const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
  const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { guestTaskControlPaths } = await import('../server/guest-task.ts');
  const { Jobs } = await import('../server/jobs.ts');
  const { Secrets } = await import('../server/secrets.ts');
  const { AppError } = await import('../server/model.ts');
  const { quote } = await import('../server/files.ts');
  const packaged = await projectIdentitySources();
  proof.packagedIdentityManifest = packaged.manifest;
  for (const [name, bytes] of packaged.files) assert.equal(hash(bytes), freeze.sourceSha256['native/project-identity/' + name]);
  await mkdir(hostScope); await persist();
  const runtime = await createRuntime(), nativeRun = runtime.run.bind(runtime);
  runtime.run = (async (...call: Parameters<typeof nativeRun>) => {
    if (call[0] !== 'sakura-qemu' || !call[1].some(value => value.includes(root))) return nativeRun(...call);
    const value: any = { startedAt: new Date().toISOString(), settled: false, argvSha256: hash(JSON.stringify(call[1])) };
    proof.qemuExecutions.push(value);
    try { return await nativeRun(...call); } finally { value.settled = true; value.finishedAt = new Date().toISOString(); }
  }) as typeof runtime.run;
  const machines = new Machines(runtime); await machines.init();
  assert.equal(machines.records.size, 1); assert.equal(machines.state(vmId), 'stopped'); assert.equal(machines.live.size, 0);
  // A default Workspaces Jobs constructor may persist interrupted historical
  // jobs. Refuse that state before constructing it and then use an own Jobs file.
  try {
    const old = JSON.parse(await readFile(join(root, 'jobs', 'projects.json'), 'utf8'));
    assert.ok(old.length <= 200, 'Do not prune the historical Workspaces Jobs file when constructing this harness.');
    assert.ok(old.every((value: any) => value.status !== 'running'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const secrets = new Secrets(machines, undefined, join(hostScope, 'secrets'));
  const spaces = new Workspaces(machines, { secrets }); await spaces.jobs.close();
  spaces.jobs = new Jobs('owned-workspaces', join(hostScope, 'jobs'));
  const terminals = new ProjectTerminals(machines, spaces), neighborTerminals = new ProjectTerminals(machines, spaces);
  const core = new ProjectIdentities(machines);
  const scopes = new ProjectRunScopes(machines), migrations = new ProjectDirectoryMigrations(machines, spaces);
  const farmFile = join(hostScope, 'farm.json'), farmJobsDir = join(hostScope, 'jobs');
  const jobsScope = 'owned-farm';
  let farm = new BuildFarm(machines, farmFile, undefined, undefined, new Jobs(jobsScope, farmJobsDir), terminals);
  const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines);
  const commands: { sha256: string; bodyAbsent: boolean }[] = [];
  const chunks = new Map<string, string[]>();
  const fault = { enabled: false, projectId: '', runId: '', live: undefined as unknown, attempts: 0,
    run: undefined as ProjectIdentityRun | undefined, reports: [] as any[], outerConfirmedAt: '' };
  const decodeControl = (command: string): any => {
    if (!command.includes('/controller.py')) return null;
    const token = command.match(/'([A-Za-z0-9+/]+=*)'$/)?.[1];
    if (!token || token.length > 131072) return null;
    try { return JSON.parse(Buffer.from(token, 'base64').toString()); } catch { return null; }
  };
  const recordCommand = (command: string) => {
    const bodyAbsent = ![bodyCanary, secretCanary, Buffer.from(bodyCanary).toString('base64'), Buffer.from(secretCanary).toString('base64')]
      .some(value => command.includes(value));
    assert.equal(bodyAbsent, true, 'A root execution command contains an owned body/secret.');
    commands.push({ sha256: hash(command), bodyAbsent });
  };
  machines.exec = (async (...call: Parameters<typeof nativeExec>) => {
    recordCommand(call[1]); const request = decodeControl(call[1]);
    if (fault.enabled && request?.action === 'stop' && request.projectId === fault.projectId && request.runId === fault.runId) {
      assert.equal(machines.live.get(vmId), fault.live); assert.ok(fault.run);
      const outer = await observe({ operation: 'scope', bootId: fault.run.bootId, run: fault.run, reports: fault.reports });
      assert.equal(outer.cgroupExists, false); assert.ok(outer.processes.every((value: any) => !value.alive));
      assert.equal(outer.control.owner.bootId, fault.run.bootId);
      fault.outerConfirmedAt ||= new Date().toISOString(); fault.attempts++;
      throw new AppError('Owned exact account-stop confirmation connection unavailable', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }
    return nativeExec(...call);
  }) as typeof machines.exec;
  machines.execInput = (async (...call: Parameters<typeof nativeInput>) => {
    recordCommand(call[1]);
    const request = call[1].startsWith('# SAKURA_GUEST_TASK_RUN') ?
      call[1].match(/sakura-task-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/)?.[1] : undefined;
    const output = call[5];
    if (request && output) {
      chunks.set(request, []);
      call[5] = text => {
        const values = chunks.get(request)!; assert.ok(values.length < 1000);
        values.push(text); assert.ok(values.join('').length < 262144); output(text);
      };
    }
    return nativeInput(...call);
  }) as typeof machines.execInput;
  const fixed = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ';
  const py = (body: string) => '/usr/bin/python3 -I -S -c ' + quote(body);
  const observe = async (request: object) => {
    const input = Buffer.from(JSON.stringify(request)); assert.ok(input.length <= 131072);
    const result = await nativeInput(vmId, fixed + py(observerPython), input, 60000);
    assert.equal(result.code, 0, mask(result.stdout + result.stderr)); assert.equal(result.stderr, '');
    assert.ok(Buffer.byteLength(result.stdout) < 2 * 1024 * 1024); return JSON.parse(result.stdout);
  };
  const execRoot = async (command: string, timeout = 30000) => {
    recordCommand(command); const result = await nativeExec(vmId, command, timeout);
    assert.equal(result.code, 0, mask(result.stdout + result.stderr)); return result.stdout.trim();
  };
  const originalCatalog = await spaces.projects.list(vmId);
  assert.ok(originalCatalog.projects.length <= (distro === 'alpine' ? 20 : 18));
  const oldConfigs = new Map<string, { file: string; sha256: string }>();
  for (const value of originalCatalog.projects) {
    const file = spaces.projects.inScope(vmId, value.id, () => spaces.projects.file(vmId));
    try { oldConfigs.set(value.id, { file, sha256: hash(await readFile(file)) }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const journalDirectory = join(machineDirectory, 'project-identities');
  const oldJournals = new Map<string, any>(), oldJournalHashes = new Map<string, string>();
  for (const name of await readdir(journalDirectory)) if (/^(default|[a-f0-9]{16})\.json$/.test(name)) {
    const bytes = await readFile(join(journalDirectory, name));
    oldJournals.set(name.slice(0, -5), JSON.parse(bytes.toString()));
    oldJournalHashes.set(name.slice(0, -5), hash(bytes));
  }
  const oldArchiveFiles: { file: string; sha256: string }[] = [];
  const preserveArchives = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await preserveArchives(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) oldArchiveFiles.push({ file: path, sha256: hash(await readFile(path)) });
    }
  };
  for (const entry of await readdir(journalDirectory, { withFileTypes: true }))
    if (entry.isDirectory()) await preserveArchives(join(journalDirectory, entry.name));
  proof.originalHostFiles = { configs: Object.fromEntries(oldConfigs), journalFileSha256: Object.fromEntries(oldJournalHashes),
    archivedReceipts: oldArchiveFiles, runEntrySha256: Object.fromEntries([...oldJournals].map(([id, value]) =>
      [id, Object.fromEntries(value.runs.map((entry: any) => [entry.runId, hash(JSON.stringify(entry))]))])),
    oldJournalRule: 'Only the two authorized Alpine journals may append new owned entries; every old serialized entry/metadata and every archive remains unchanged.' };
  const journal = async (id: string) => JSON.parse(await readFile(join(journalDirectory, id + '.json'), 'utf8'));
  const readyPaths: string[] = [];
  for (const attempt of prior.installAttempts || []) {
    const ready = attempt.readyReceipt?.receipt;
    if (!ready) continue;
    assert.equal(ready.phase, 'ready'); assert.ok(['node', 'python'].includes(ready.tool));
    assert.equal(ready.requestedVersion, ready.tool === 'node' ? '22.12.0' : '3.12.12');
    readyPaths.push('/opt/sakura-runtimes/' + ready.tool + '-' + ready.requestedVersion);
    if (ready.tool === 'python') {
      assert.match(ready.installId, uuidPattern); readyPaths.push('/opt/sakura-runtimes/python-managed-' + ready.installId);
    }
  }
  let baseline: any, bootId = '', alphaId = '', betaId = '', alpha!: Project, beta!: Project;
  let alphaIdentity!: ProjectIdentity, betaIdentity!: ProjectIdentity;
  let alphaChild = '', betaChild = '', heldLease: Awaited<ReturnType<typeof terminals.prepare>> | undefined;
  const ownedRunIds = new Map<string, Set<string>>();
  const tracked = new Map<string, { id: string; run: ProjectIdentityRun; reports: any[] }>();
  const labelForTask = new Map<string, string>();
  const inScope = <T>(id: string, action: () => Promise<T>) => spaces.projects.inScope(vmId, id, action);
  const item = (id: string) => { const value = farm.view().tasks.find(value => value.id === id); assert.ok(value); return value; };
  const waitTask = async (id: string, expected: string, timeout = 100000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = item(id);
      if (value.status === expected) { await farm.jobs.wait(id); return item(id); }
      assert.ok(!['done', 'error', 'cancelled', 'interrupted'].includes(value.status), mask(value.error || value.status));
      await delay(100);
    }
    throw new Error('Owned build deadline exceeded: ' + expected);
  };
  const node = async (id: string, slots = 2, enabled = true) => farm.action({ operation: 'save-node',
    node: { vmId, projectId: id, slots, labels: ['owned-identity'], enabled } });
  const submit = async (name: string, command: string, cwd?: string) => {
    assert.ok(command.length <= 4096); const value: any = await farm.action({ operation: 'submit',
      build: { name: invocation.slice(0, 8) + '-' + name, command, ...(cwd ? { cwd } : {}),
        labels: ['owned-identity'], timeoutSeconds: 180 } }); return value.id as string;
  };
  const command = (child: string, mode: string, label: string, extra: string[] = []) =>
    'BUILD_BODY=' + quote(bodyCanary) + ' /usr/bin/python3 -I -S ' + quote(child + '/fixture.py') + ' ' +
    [mode, label, hash(bodyCanary), rootOnly, ...extra].map(quote).join(' ');
  const runsAfter = async (id: string, before: Set<string>) => {
    const current = await journal(id), set = ownedRunIds.get(id) || new Set<string>();
    for (const entry of current.runs) if (!before.has(entry.runId)) {
      assert.equal(entry.owner.kind, 'task'); assert.equal(entry.owner.bootId, bootId);
      set.add(entry.runId);
    }
    ownedRunIds.set(id, set); return current.runs.filter((value: any) => !before.has(value.runId));
  };
  const completed = async (id: string, code: string, cwd?: string) => {
    const before = new Set<string>((await journal(id)).runs.map((value: any) => value.runId));
    const taskId = await submit('once', code, cwd), result = await waitTask(taskId, 'done');
    const entries = await runsAfter(id, before); assert.equal(entries.length, 1); const entry = entries[0];
    assert.equal(entry.phase, 'closed'); assert.equal(entry.run?.phase, 'closed');
    const observed = await observe({ operation: 'scope', bootId, run: entry.run });
    assert.equal(observed.cgroupExists, false); assert.equal(observed.control.exists, false);
    const taskResult = await farm.jobs.result(result.jobId!);
    assert.equal(taskResult.exitCode, 0); assert.equal(result.projectId, id);
    return { taskId, entry, task: result, result: taskResult };
  };
  const stage = async (id: string, project: Project, identity: ProjectIdentity) => {
    await node(id); const child = project.directory + '/build-farm-' + invocation;
    const initialize = stageInitializePython(child);
    const first = await completed(id, py(initialize)); assert.equal(JSON.parse(first.result.stdout).uid, identity.uid);
    const bytes = Buffer.from(applicationPython); let offset = 0;
    while (offset < bytes.length) {
      const part = bytes.subarray(offset, offset + 1400), expected = offset;
      const code = stageChunkPython(child, identity.uid, expected, part);
      await completed(id, py(code)); offset += part.length;
    }
    const once = await completed(id, command(child, 'once', 'staged'), child);
    const report = JSON.parse(once.result.stdout); validateReport(report, identity, child);
    return { child, report, stageTasks: Math.ceil(bytes.length / 1400) + 2, programSha256: hash(bytes) };
  };
  const validateReport = (report: any, identity: ProjectIdentity, cwd: string) => {
    assert.equal(report.uid, identity.uid); assert.equal(report.euid, identity.uid); assert.equal(report.gid, identity.gid);
    assert.deepEqual(report.groups, []); assert.equal(report.home, identity.home); assert.equal(report.cwd, cwd);
    assert.equal(report.bootId, bootId); assert.equal(report.noNewPrivs, '1'); assert.equal(report.bodyPresent, true);
    assert.equal(report.rootWriteDenied, true); for (const value of Object.values(report.caps)) assert.match(String(value), /^0+$/);
    assert.equal(report.descriptors.some((value: any) =>
      /\/sys\/fs\/cgroup(?:\/|$)|\/(?:run|var\/lib)\/(?:sakura-project-identities|sakura-guest-tasks)(?:\/|$)/.test(value.target)), false);
  };
  const active = async (id: string, child: string, label: string, taskId: string) => {
    const identity = id === alphaId ? alphaIdentity : betaIdentity, deadline = Date.now() + 45000;
    const paths = ['leader', 'newgroup', 'setsid', 'doublefork'].map(suffix => child + '/' + label + '-' + suffix + '.json');
    while (Date.now() < deadline) {
      const task = item(taskId); assert.ok(!['error', 'done', 'cancelled', 'interrupted'].includes(task.status), mask(task.error || task.status));
      const value = await observe({ operation: 'markers', bootId, uid: identity.uid, paths });
      if (!value.complete || value.reports.length !== 4) { await delay(100); continue; }
      for (const report of value.reports) {
        validateReport(report, identity, child); assert.equal(report.observed.alive, true);
        assert.equal(report.observed.uid, identity.uid);
        assert.equal(report.observed.cgroup, report.cgroup);
        assert.equal(report.observed.networkDevice, report.networkDevice); assert.equal(report.observed.networkInode, report.networkInode);
      }
      const groups = new Set<string>(value.reports.map((value: any) => value.cgroup)); assert.equal(groups.size, 1);
      const runId = value.reports[0].cgroup.match(/^0::\/sakura-task-([a-f0-9-]{36})$/)?.[1]; assert.ok(runId); assert.match(runId, uuidPattern);
      const entry = (await journal(id)).runs.find((value: any) => value.runId === runId); assert.ok(entry);
      assert.equal(entry.owner.kind, 'task'); assert.equal(entry.owner.bootId, bootId); assert.deepEqual(entry.identity, identity);
      const run = await core.runReadonly(vmId, identity, runId); assert.equal(run.phase, 'active');
      assert.equal(run.cgroupName, 'sakura-task-' + runId); assert.equal(run.bootId, bootId);
      for (const report of value.reports) {
        assert.equal(report.networkDevice, run.networkDevice); assert.equal(report.networkInode, run.networkInode);
      }
      const set = ownedRunIds.get(id) || new Set<string>(); set.add(runId); ownedRunIds.set(id, set);
      const record = { id, run, reports: value.reports }; tracked.set(runId, record); labelForTask.set(taskId, label);
      proof.ownedActiveRuns ||= []; proof.ownedActiveRuns.push({ taskId, projectId: id, run, reports: value.reports }); await persist();
      return record;
    }
    throw new Error('Owned active descendants were not observed: ' + label);
  };
  const stopped = async (record: { id: string; run: ProjectIdentityRun; reports: any[] }, allowControl = false) => {
    const result = await observe({ operation: 'scope', bootId, run: record.run, reports: record.reports });
    assert.equal(result.cgroupExists, false); assert.ok(result.processes.every((value: any) => !value.alive));
    const value = await core.runReadonly(vmId, record.id === alphaId ? alphaIdentity : betaIdentity, record.run.runId);
    assert.equal(value.phase, 'closed'); assert.deepEqual({ ...value, phase: 'active' }, record.run);
    const entry = (await journal(record.id)).runs.find((entry: any) => entry.runId === record.run.runId);
    assert.ok(entry); assert.equal(entry.phase, 'closed'); assert.deepEqual(entry.run, value);
    if (!allowControl) assert.equal(result.control.exists, false);
    tracked.delete(record.run.runId); return { ...result, ticket: value };
  };
  const sanitizedTask = (value: ReturnType<typeof item>) => {
    const { command: _command, job, ...rest } = value;
    return { ...rest, ...(job ? { job: { ...job, logSha256: hash(job.log), log: mask(job.log) } } : {}), commandSha256: hash(_command) };
  };
  let aTask = '', bTask = '', aRun: Awaited<ReturnType<typeof active>> | undefined;
  let bRun: Awaited<ReturnType<typeof active>> | undefined, faultTask = '', faultRun: Awaited<ReturnType<typeof active>> | undefined;
  try {
    await check(caseNames[0], async () => {
      await machines.start(vmId);
      const deadline = Date.now() + 180000;
      while (machines.state(vmId) !== 'running') { assert.ok(Date.now() < deadline); await delay(300); }
      await machines.connect(vmId);
      bootId = await execRoot(fixed + '/bin/cat /proc/sys/kernel/random/boot_id'); assert.match(bootId, uuidPattern);
      assert.notEqual(bootId, prior.bootId); proof.bootId = bootId;
      proof.identityBuild = await core.install(vmId);
      baseline = await observe({ operation: 'baseline', bootId, readyPaths });
      proof.originalGuestBaseline = baseline;
      await farm.init();
      return { bootId, originalAccounts: Object.keys(baseline.accounts).length, originalReadyTrees: baseline.readyTrees,
        noNewDisksOrSnapshots: true, defaultClient: proof.client };
    });
    await check(caseNames[1], async () => {
      if (distro === 'alpine') {
        alphaId = alpinePair.alpha; betaId = alpinePair.beta;
        assert.equal(originalCatalog.projects.length, 20);
        for (const id of [alphaId, betaId]) {
          assert.ok(originalCatalog.projects.some(value => value.id === id));
          const original = oldJournals.get(id); assert.ok(original?.identity); assert.equal(original.pending, null);
          assert.ok(original.runs.every((value: any) => value.phase === 'closed'));
          assert.ok(!original.networkRelease || original.networkRelease.phase === 'released');
          assert.deepEqual(await core.inspect(vmId, id), original.identity);
        }
        alpha = await inScope(alphaId, () => spaces.config(vmId)); beta = await inScope(betaId, () => spaces.config(vmId));
        assert.equal(alpha.directory, '/workspace/sakura-runtime-probe-' + alpinePair.invocation);
        assert.equal(beta.directory, '/workspace/sakura-runtime-neighbor-' + alpinePair.invocation);
        assert.deepEqual(alpha.secrets || {}, {}); assert.deepEqual(beta.secrets || {}, {});
        alphaIdentity = oldJournals.get(alphaId).identity; betaIdentity = oldJournals.get(betaId).identity;
      } else {
        await secrets.save(vmId, { name: 'FarmOwnedSecret', value: secretCanary });
        const result = await nativeInput(vmId, fixed + py(bootstrapPython), Buffer.from(JSON.stringify({ rootOnly, base, newProjects: true })), 30000);
        assert.equal(result.code, 0, mask(result.stdout + result.stderr));
        for (const role of ['alpha', 'beta'] as const) {
          const created = await spaces.projects.create(vmId, 'Owned farm ' + role + ' ' + invocation.slice(0, 8), async () => {
            await spaces.save(vmId, { directory: base + '/' + role, networkIsolation: 'private',
              environment: { PATH: '/usr/bin:/bin' }, ...(role === 'alpha' ? { secrets: { FARM_SECRET: 'FarmOwnedSecret' } } : {}) });
          });
          const id = created.active; if (role === 'alpha') alphaId = id; else betaId = id;
          await inScope(id, async () => {
            const preview = await migrations.preview(vmId); assert.ok(preview.plan);
            proof.directoryMigrations ||= []; proof.directoryMigrations.push({ projectId: id, planId: preview.plan.proposal.planId,
              sha256: preview.plan.sha256, preview }); await persist();
            await migrations.apply(vmId, { action: 'apply', version: 1, reviewed: true,
              planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
          });
        }
        alpha = await inScope(alphaId, () => spaces.config(vmId)); beta = await inScope(betaId, () => spaces.config(vmId));
        alphaIdentity = await scopes.identity(vmId, alpha); betaIdentity = await scopes.identity(vmId, beta);
      }
      if (distro === 'alpine') {
        const result = await nativeInput(vmId, fixed + py(bootstrapPython), Buffer.from(JSON.stringify({ rootOnly, base, newProjects: false })), 30000);
        assert.equal(result.code, 0, mask(result.stdout + result.stderr));
      }
      assert.notEqual(alphaId, betaId); assert.notEqual(alphaIdentity.uid, betaIdentity.uid);
      for (const value of [alphaIdentity, betaIdentity]) { assert.equal(value.phase, 'active'); assert.equal(value.networkIsolation, 'private'); }
      proof.projectPair = { alpha: { id: alphaId, identity: alphaIdentity, configVersion: projectVersion(alpha) },
        beta: { id: betaId, identity: betaIdentity, configVersion: projectVersion(beta) }, reused: distro === 'alpine',
        newAccountsClaimed: distro !== 'alpine', newMigrationsClaimed: distro !== 'alpine' };
      return proof.projectPair;
    });
    await check(caseNames[2], async () => {
      const alphaStage = await stage(alphaId, alpha, alphaIdentity); alphaChild = alphaStage.child;
      const betaStage = await stage(betaId, beta, betaIdentity); betaChild = betaStage.child;
      await node(alphaId); await spaces.projects.update(vmId, betaId);
      const alphaNs = await observe({ operation: 'namespace', bootId, projectId: alphaId });
      const betaNs = await observe({ operation: 'namespace', bootId, projectId: betaId });
      assert.equal(alphaStage.report.networkInode, alphaNs.private.inode); assert.notEqual(alphaNs.private.inode, alphaNs.host.inode);
      assert.equal(betaStage.report.networkInode, betaNs.private.inode); assert.notEqual(alphaNs.private.inode, betaNs.private.inode);
      proof.retainedGuestPaths.push(alphaChild, betaChild, rootOnly);
      return { alphaStage, betaStage, namespaces: { alpha: alphaNs, beta: betaNs }, activeProject: betaId,
        originalIdentityDirectoryKept: true, bodyTransport: 'Real protected projectIdentityTask input through BuildFarm.' };
    });
    await check(caseNames[3], async () => {
      aTask = await submit('overlap-a', command(alphaChild, 'hang', 'overlap-a'), alphaChild);
      aRun = await active(alphaId, alphaChild, 'overlap-a', aTask);
      bTask = await submit('overlap-b', command(alphaChild, 'hang', 'overlap-b'), alphaChild);
      bRun = await active(alphaId, alphaChild, 'overlap-b', bTask);
      assert.notEqual(aRun.run.runId, bRun.run.runId); assert.notEqual(aRun.run.cgroupInode, bRun.run.cgroupInode);
      assert.equal(aRun.run.identityId, bRun.run.identityId); assert.equal(aRun.run.networkInode, bRun.run.networkInode);
      const first = await observe({ operation: 'scope', bootId, run: aRun.run, reports: aRun.reports });
      const second = await observe({ operation: 'scope', bootId, run: bRun.run, reports: bRun.reports });
      for (const value of [first, second]) { assert.equal(value.cgroupExists, true); assert.ok(value.processes.every((value: any) => value.alive)); }
      assert.equal(farm.view().nodes[0].busy, 2); assert.equal(item(aTask).status, 'running'); assert.equal(item(bTask).status, 'running');
      for (const id of [aTask, bTask]) {
        const value = item(id); assert.equal(value.projectId, alphaId); assert.equal(value.projectDirectory, alpha.directory);
        assert.equal(value.directory, alphaChild); assert.equal(value.configVersion, projectVersion(alpha));
      }
      return { observedTogetherAt: new Date().toISOString(), first, second, identityId: alphaIdentity.identityId,
        taskIds: [aTask, bTask], activeSelectionIgnored: betaId, actualBusySlots: 2 };
    });
    await check(caseNames[4], async () => {
      await assert.rejects(() => node(betaId), (error: any) => error.status === 409);
      await assert.rejects(() => inScope(alphaId, () => spaces.save(vmId, { ...alpha, networkIsolation: 'host' })),
        (error: any) => error.status === 409);
      await assert.rejects(() => inScope(alphaId, () => migrations.preview(vmId)),
        (error: any) => error.code === 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
      assert.deepEqual(await core.inspect(vmId, alphaId), alphaIdentity);
      assert.equal(projectVersion(await inScope(alphaId, () => spaces.config(vmId))), projectVersion(alpha));
      return { nodeRetargetDenied: true, configurationRebindDenied: true, migrationDeniedByPreparedTaskLeases: true };
    });
    await check(caseNames[5], async () => {
      await farm.action({ operation: 'cancel', id: aTask }); const value = await waitTask(aTask, 'cancelled');
      const cleanup = await stopped(aRun!);
      const neighbor = await observe({ operation: 'scope', bootId, run: bRun!.run, reports: bRun!.reports });
      assert.equal(neighbor.cgroupExists, true); assert.ok(neighbor.processes.every((value: any) => value.alive));
      assert.equal(item(bTask).status, 'running');
      return { task: sanitizedTask(value), cleanup, neighbor };
    });
    await check(caseNames[6], async () => {
      const before = new Set<string>((await journal(betaId)).runs.map((value: any) => value.runId));
      const leader = bRun!.reports[0];
      const result = await projectIdentityTask(machines, vmId, await inScope(betaId, () => spaces.resolvedConfig(vmId)),
        { command: command(betaChild, 'neighbor', 'neighbor-read', [String(leader.pid), leader.ticks, alphaChild + '/fixture.py']),
          environment: (await inScope(betaId, () => spaces.resolvedConfig(vmId))).environment }, new AbortController().signal, undefined, 60000);
      assert.equal(result.code, 0, mask(result.stdout + result.stderr)); assert.equal(result.stderr, '');
      const report = JSON.parse(result.stdout); validateReport(report, betaIdentity, beta.directory);
      for (const key of ['environmentDenied', 'descriptorsDenied', 'scriptDenied']) assert.equal(report[key], true);
      assert.equal(report.foreignArgvContainsBody, false); assert.equal(report.rootArgvContainsBody, false);
      const entries = await runsAfter(betaId, before); assert.equal(entries.length, 1); assert.equal(entries[0].phase, 'closed');
      const neighbor = await observe({ operation: 'scope', bootId, run: bRun!.run, reports: bRun!.reports });
      assert.ok(neighbor.processes.every((value: any) => value.alive));
      return { report, originalNeighborRun: bRun!.run, otherUid: betaIdentity.uid };
    });
    await check(caseNames[7], async () => {
      await farm.action({ operation: 'cancel', id: bTask }); const value = await waitTask(bTask, 'cancelled');
      return { task: sanitizedTask(value), cleanup: await stopped(bRun!) };
    });
    await check(caseNames[8], async () => {
      const successful = await completed(alphaId, 'false; true', alphaChild);
      const reportTask = await completed(alphaId, command(alphaChild, 'once', 'cwd-after'), alphaChild);
      const report = JSON.parse(reportTask.result.stdout); validateReport(report, alphaIdentity, alphaChild);
      const rejected = await submit('outside-root', 'exit 0', beta.directory);
      const failure = await waitTask(rejected, 'error'); assert.match(failure.error || '', /项目目录/);
      assert.equal(failure.projectId, alphaId); assert.deepEqual(await core.inspect(vmId, alphaId), alphaIdentity);
      return { nonzeroThenSuccess: successful.result.exitCode, task: sanitizedTask(reportTask.task), report,
        outsideProjectRejected: sanitizedTask(failure), rootBindingDirectory: alphaIdentity.directory };
    });
    if (distro !== 'alpine') await check(caseNames[9], async () => {
      const value = await completed(alphaId, command(alphaChild, 'secret', 'split-secret'), alphaChild);
      const raw = chunks.get(value.entry.runId); assert.ok(raw && raw.length >= 6);
      assert.equal(raw.join('').split(secretCanary).length - 1, 2);
      assert.ok(raw.every(chunk => !chunk.includes(secretCanary)), 'Secret chunks were not split in the real transport.');
      const text = value.task.job!.log + JSON.stringify(value.result);
      assert.equal(text.includes(secretCanary), false); assert.match(text, /私密配置已隐藏/);
      assert.equal((await readFile(join(hostScope, 'secrets', vmId + '.json'), 'utf8')).includes(secretCanary), false);
      return { task: sanitizedTask(value.task), runId: value.entry.runId, observedTransportChunks: raw.length,
        originalSecretOccurrences: 2, rawOutputPersisted: false, resultSha256: hash(JSON.stringify(value.result)),
        fixtureStore: 'Real Secrets default Windows DPAPI in this new host scope.' };
    });
    await check(caseNames[10], async () => {
      faultTask = await submit('account-confirm-fault', command(alphaChild, 'hang', 'account-fault'), alphaChild);
      faultRun = await active(alphaId, alphaChild, 'account-fault', faultTask);
      Object.assign(fault, { enabled: true, projectId: alphaId, runId: faultRun.run.runId,
        live: machines.live.get(vmId), run: faultRun.run, reports: faultRun.reports });
      await farm.action({ operation: 'cancel', id: faultTask }); const value = await waitTask(faultTask, 'error');
      assert.equal(value.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED'); assert.equal(value.job?.status, 'error');
      assert.equal(value.job?.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED'); assert.ok(fault.attempts >= 9);
      const observed = await observe({ operation: 'scope', bootId, run: faultRun.run, reports: faultRun.reports });
      assert.equal(observed.cgroupExists, false); assert.ok(observed.processes.every((value: any) => !value.alive));
      assert.equal(observed.control.exists, true); assert.ok(observed.control.owner);
      const entry = (await journal(alphaId)).runs.find((value: any) => value.runId === faultRun!.run.runId);
      assert.equal(entry.phase, 'active'); assert.equal(entry.run.phase, 'active');
      await assert.rejects(() => scopes.guard(vmId, alphaId), (error: any) => error.code === 'PROJECT_IDENTITY_RUNS_MUST_STOP');
      await assert.rejects(() => inScope(alphaId, () => spaces.save(vmId, { ...alpha, networkIsolation: 'host' })),
        (error: any) => error.status === 409);
      const refused = await submit('unconfirmed-account-must-not-run', command(alphaChild, 'once', 'must-not-run'), alphaChild);
      const refusal = await waitTask(refused, 'error'); assert.equal(refusal.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      const marker = await observe({ operation: 'paths', bootId, paths: [alphaChild + '/must-not-run-leader.json'] });
      assert.equal(marker.paths[alphaChild + '/must-not-run-leader.json'], null);
      await farm.close();
      farm = new BuildFarm(machines, farmFile, undefined, undefined, new Jobs(jobsScope, farmJobsDir), terminals); await farm.init();
      const reloaded = item(faultTask); assert.equal(reloaded.status, 'error'); assert.equal(reloaded.errorCode, value.errorCode);
      return { failedTask: sanitizedTask(value), refusedTask: sanitizedTask(refusal), accountStopConnectionsBlocked: fault.attempts,
        outerCgroupActuallyGone: true, independentlyConfirmedBeforeBlockedConnectionAt: fault.outerConfirmedAt,
        retainedAccountEntry: entry, retainedControl: observed.control,
        reload: sanitizedTask(reloaded), activeDomainsFabricated: false };
    });
    await check(caseNames[11], async () => {
      fault.enabled = false;
      const before = await observe({ operation: 'scope', bootId, run: faultRun!.run, reports: faultRun!.reports });
      assert.equal(before.cgroupExists, false); assert.ok(before.processes.every((value: any) => !value.alive));
      await scopes.recoverStoppedTasks(vmId, alphaId); const recovered = await stopped(faultRun!, true);
      await scopes.guard(vmId, alphaId); assert.equal(recovered.control.exists, true);
      assert.deepEqual(recovered.control, before.control, 'Account recovery did not retire the separate failed callback control directory.');
      proof.retainedGuestPaths.push(recovered.control.directory);
      proof.retainedControlEvidence = { ...recovered.control, reason: 'guestTask afterCleanup failed; account recovered via public API, control receipt deliberately retained without reconstructing a nonce command.' };
      const healthy = await completed(alphaId, command(alphaChild, 'once', 'after-recovery'), alphaChild);
      assert.equal(item(faultTask).status, 'error'); assert.equal(item(faultTask).errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      return { recovered, healthyTask: sanitizedTask(healthy.task), historicalErrorPreserved: true,
        noManualSignalOrGuestReceiptEdit: true, controlDirectoryRetiredClaimed: false };
    });
    await check(caseNames[12], async () => {
      heldLease = await neighborTerminals.prepare(vmId, betaId, null);
      const taskId = await submit('close-live-descendants', command(alphaChild, 'hang', 'close-active'), alphaChild);
      const running = await active(alphaId, alphaChild, 'close-active', taskId);
      await farm.close(); const closed = item(taskId); assert.equal(closed.status, 'cancelled');
      const cleanup = await stopped(running);
      assert.throws(() => assertProjectTerminalsStopped(machines, vmId, betaId),
        (error: any) => error.code === 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
      heldLease.release(); heldLease = undefined; assertProjectTerminalsStopped(machines, vmId, betaId);
      return { task: sanitizedTask(closed), cleanup, anotherPreparedLeaseSurvivedFarmClose: true };
    });
    await check(caseNames[13], async () => {
      const before = await journal(alphaId);
      farm = new BuildFarm(machines, farmFile, undefined, undefined, new Jobs(jobsScope, farmJobsDir), terminals); await farm.init();
      await delay(2300);
      assert.deepEqual(await journal(alphaId), before); assert.equal(farm.view().nodes[0].projectId, alphaId);
      assert.equal(item(faultTask).status, 'error'); assert.equal(item(faultTask).errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      for (const value of farm.view().tasks) assert.ok(!['running', 'queued'].includes(value.status));
      const rootArgv = await observe({ operation: 'root-argv', bootId,
        needles: [bodyCanary, secretCanary, Buffer.from(bodyCanary).toString('base64'), Buffer.from(secretCanary).toString('base64')] });
      assert.deepEqual(rootArgv.matchingRootPids, []);
      return { runJournalUnchangedAfterReload: true, nodeProjectId: alphaId, activeCatalogProject: betaId,
        finalTaskCounts: farm.view().tasks.reduce((counts: Record<string, number>, value) => {
          counts[value.status] = (counts[value.status] || 0) + 1; return counts;
        }, {}), rootArgv, observedRootCommands: commands.length, rootCommandBodiesAbsent: commands.every(value => value.bodyAbsent) };
    });
  } catch (error) {
    proof.error = mask(error instanceof Error ? error.stack || error.message : error); await line('FAIL ' + proof.error);
  } finally {
    proof.cleanupErrors = []; fault.enabled = false;
    const cleanupError = (label: string, error: unknown) => proof.cleanupErrors.push(label + ': ' + mask(error));
    try { await farm.close(); } catch (error) { cleanupError('Farm close', error); }
    if (heldLease) { heldLease.release(); heldLease = undefined; }
    if (machines.live.has(vmId) && bootId) {
      for (const id of [alphaId, betaId].filter(Boolean)) {
        try {
          // Baseline closed receipts are never candidates for this recovery.
          const old = oldJournals.get(id);
          assert.ok(!old || old.runs.every((value: any) => value.phase === 'closed'));
          await scopes.recoverStoppedTasks(vmId, id); await scopes.guard(vmId, id);
          const current = await journal(id);
          for (const entry of current.runs) if (ownedRunIds.get(id)?.has(entry.runId)) assert.equal(entry.phase, 'closed');
        } catch (error) { cleanupError('Owned account recovery ' + id, error); }
      }
      try {
        for (const [runId, value] of tracked) {
          const observation = await observe({ operation: 'scope', bootId, run: value.run, reports: value.reports });
          assert.equal(observation.cgroupExists, false); assert.ok(observation.processes.every((value: any) => !value.alive));
          proof.finalOwnedScopes ||= []; proof.finalOwnedScopes.push({ runId, ...observation });
        }
        const current = await observe({ operation: 'baseline', bootId, readyPaths });
        assert.equal(current.registryId, baseline.registryId); assert.deepEqual(current.readyTrees, baseline.readyTrees);
        assert.deepEqual(current.readyReceipts, baseline.readyReceipts);
        for (const [name, value] of Object.entries(baseline.accounts)) assert.deepEqual(current.accounts[name], value);
        for (const [name, value] of Object.entries(baseline.bindings)) assert.equal(current.bindings[name], value);
        for (const [key, value] of Object.entries(baseline.reserved)) assert.deepEqual(current.reserved[key], value);
        proof.originalAccountsBindingsAndReadyAssetsUnchanged = true;
      } catch (error) { cleanupError('Original guest account/assets preservation', error); }
      try {
        await spaces.projects.update(vmId, originalCatalog.active);
        const current = await spaces.projects.list(vmId); assert.equal(current.active, originalCatalog.active);
        assert.deepEqual(current.projects.slice(0, originalCatalog.projects.length), originalCatalog.projects);
        assert.equal(current.projects.length, originalCatalog.projects.length + (distro === 'alpine' ? 0 : 2));
        for (const value of oldConfigs.values()) assert.equal(hash(await readFile(value.file)), value.sha256);
        for (const [id, old] of oldJournals) {
          const current = await journal(id);
          if (distro === 'alpine' && [alphaId, betaId].includes(id)) {
            const { runs: oldRuns, ...oldMeta } = old, { runs: currentRuns, ...currentMeta } = current;
            assert.equal(JSON.stringify(currentMeta), JSON.stringify(oldMeta));
            for (const entry of oldRuns) {
              const stored = currentRuns.find((value: any) => value.runId === entry.runId);
              const archived = stored || JSON.parse(await readFile(join(journalDirectory, id, 'closed-runs', entry.runId + '.json'), 'utf8'));
              assert.equal(JSON.stringify(archived), JSON.stringify(entry));
            }
            assert.ok(currentRuns.every((entry: any) => oldRuns.some((value: any) => value.runId === entry.runId) || ownedRunIds.get(id)?.has(entry.runId)));
          } else {
            assert.deepEqual(current, old);
            assert.equal(hash(await readFile(join(journalDirectory, id + '.json'))), oldJournalHashes.get(id));
          }
        }
        for (const file of oldArchiveFiles) assert.equal(hash(await readFile(file.file)), file.sha256);
        proof.originalSelectionRestored = true; proof.originalConfigsAndEveryOldHostReceiptUnchanged = true;
      } catch (error) { cleanupError('Original host/config preservation', error); }
    }
    machines.exec = nativeExec; machines.execInput = nativeInput;
    try { await terminals.close(); } catch (error) { cleanupError('Terminal close', error); }
    try { await neighborTerminals.close(); } catch (error) { cleanupError('Neighbor terminal close', error); }
    try { await spaces.close(); } catch (error) { cleanupError('Workspace close', error); }
    if (machines.live.has(vmId) && machines.state(vmId) === 'running') {
      try { await execRoot(fixed + '/bin/sync'); proof.syncedBeforeStopAt = new Date().toISOString(); }
      catch (error) { cleanupError('Owned sync', error); }
    }
    try { await machines.close(); } catch (error) { cleanupError('Machines close', error); }
    proof.vmStopped = machines.state(vmId) === 'stopped'; proof.liveEntries = machines.live.size;
    proof.ownedQemuSettled = proof.qemuExecutions.every((value: any) => value.settled);
    proof.exactQemuMatches = exactQemu(); proof.stoppedAt = new Date().toISOString();
    try {
      const finalRecords = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
      assert.equal(finalRecords.length, 1);
      const stable = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'lastUsedAt'));
      assert.deepEqual(stable(finalRecords[0]), stable(setup.record));
      proof.originalMachineRecordUnchangedExceptLastUsedAt = true;
    } catch (error) { cleanupError('Original exact machine record changed', error); }
    for (const value of historicalFiles) if (hash(await readFile(value.file)) !== value.sha256) cleanupError('Historical proof changed', value.file);
    proof.finalSourceSha256 = {};
    for (const [file, expected] of Object.entries(freeze.sourceSha256)) {
      const actual = hash(await readFile(join(workspace, file))); proof.finalSourceSha256[file] = actual;
      if (actual !== expected) cleanupError('Source changed', file);
    }
    proof.finalScriptSha256 = hash(await readFile(scriptFile));
    if (proof.finalScriptSha256 !== proof.scriptSha256) cleanupError('Smoke changed', scriptFile);
    if (hash(await readFile(freezeFile)) !== hash(freezeBytes)) cleanupError('Freeze changed', freezeFile);
    try {
      const finalAssets = await projectIdentitySources(); assert.deepEqual(finalAssets.manifest, packaged.manifest);
      proof.packagedIdentityUnchanged = true;
    } catch (error) { cleanupError('Packaged identity assets changed', error); }
    if (!proof.vmStopped || proof.liveEntries || !proof.ownedQemuSettled || proof.exactQemuMatches) cleanupError('Owned VM processes did not settle', 'stopped/live/QEMU guard');
    if (commands.some(value => !value.bodyAbsent)) cleanupError('Root argv body exposure', 'recorded command');
    chunks.clear();
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === proof.expectedCases;
    proof.phase = proof.passed ? 'finished' : 'failed';
    await persist(); await line('Build farm identity proof: ' + proofFile); await log.sync(); await log.close();
    process.exitCode = proof.passed ? 0 : 1;
  }
  if (!proof.passed) throw new Error('Owned build farm smoke failed; original evidence retained at ' + proofFile);
}
