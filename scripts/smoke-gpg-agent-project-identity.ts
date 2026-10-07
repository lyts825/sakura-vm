/** 烟雾验收：验证GnuPG 中继源身份、nonce 前拒绝、项目绑定与本轮运行票据清理。
 * Smoke acceptance for GnuPG source identity, pre-nonce refusal, project binding and exact-run retirement. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectIdentity, ProjectIdentityRun } from '../server/project-identity.ts';
import type { GpgAgentContext } from '../server/gpg-agent-scope.ts';
import type { OwnedGpgForward } from '../server/gpg-agent-host.ts';
import type { Engine } from '../server/runtime.ts';

// A new proof: old Farm, SSH and prototype proofs retain their own attribution.
const fixtures = {
  alpine: { name: 'sakura-guest-task-Oky2Cx', id: '45bd380f-5274-4bd8-968e-e2cb7ece4d1b',
    proof: 'build-farm-identity-evidence-27df3b09-4a47-4148-83bb-1baa85c70e9a.json',
    sha256: '4864b8c83d4ef8b971e3e3a5fca0e16ca8851fbf44c813dbf2a6e0b0d2716ef8',
    alpha: '110d83e57d1ff1b1', beta: 'ba739f4b664cb114' },
  debian: { name: 'sakura-guest-task-i24quD', id: '645d78d1-2848-4665-b2c1-e47903525834',
    proof: 'build-farm-identity-evidence-5b7a6c92-a125-499a-8fd5-0fb8a69fb873.json',
    sha256: '9f806d383f22c20d10d1219674840a359982a6acdd1b05cad3f7a00d585009e1',
    alpha: '53d89146a013a1fd', beta: '6ac8b60a75f28af8' },
  ubuntu: { name: 'sakura-guest-task-dhGwI9', id: 'f7cf98e3-e839-4eae-a55c-a214a7bdf472',
    proof: 'build-farm-identity-evidence-78f679c5-7fa9-45ce-91bf-5a76c6d9cd52.json',
    sha256: 'afd646a379cefd2b1b6406353910a3fe03d5e3a9c16ebc78b659b8744de21fa9',
    alpha: '83144c3a2f3ec775', beta: '8e7b77b45cf736d8' },
} as const;
type Distro = keyof typeof fixtures;
const inputNames = ['SOURCE', 'PUBLIC', 'PAYLOAD', 'CIPHERTEXT'] as const;
type InputName = typeof inputNames[number];
type Pin = { path: string; sha256: string; size: number; bytes?: Buffer };
type HostRootPin = { id: string; owner: string; aclSha256: string; attributes: number;
  links: number; directory: true; protectedAcl: true };
type FileDigest = { path: string; sha256: string; bytes: number; device: number; inode: number; mtimeMs: number };
const requiredSources = [
  'server/gpg-agent-forward.ts', 'server/gpg-agent-scope.ts', 'server/gpg-agent-host.ts', 'server/gpg-agent-broker.py',
  'server/project-run-scope.ts', 'server/guest-task.ts', 'server/project-identity.ts', 'server/project-directory-migration.ts',
  'server/project-terminals.ts', 'server/project-execution.ts', 'server/workspaces.ts', 'server/project-catalog.ts',
  'server/capability-definitions.ts', 'server/capability-actions.ts',
  'server/machines.ts', 'server/runtime.ts', 'server/secrets.ts', 'server/local-store.ts',
  'server/seed.ts', 'server/boot-guard.ts', 'server/model.ts', 'server/data-directory.ts', 'server/qmp.ts',
  'server/storage-pools.ts', 'server/resource-policies.ts', 'server/project-network-isolation.ts', 'shared/hardware.ts',
  'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
  'native/gpg-agent/windows-relay.cpp', 'scripts/build-gpg-agent-host.mjs', 'scripts/prepare-gpg-agent.mjs',
  'scripts/prepare-server-assets.mjs', 'scripts/check-distribution.mjs', 'scripts/smoke-gpg-agent-project-identity.ts',
  'scripts/smoke-gpg-agent-forward.ts', 'package.json',
];
const requiredAssets = [
  '.sakura-server/assets/gpg-agent/manifest.json', '.sakura-server/assets/gpg-agent/broker.py',
  '.sakura-server/assets/gpg-agent-host/manifest.json', '.sakura-server/assets/gpg-agent-host/relay.exe',
  '.sakura-server/assets/gpg-agent-host-source.cpp', '.sakura-server/assets/project-identity/manifest.json',
  '.sakura-server/assets/project-identity/protocol.h', '.sakura-server/assets/project-identity/launcher.c',
  '.sakura-server/assets/project-identity/controller.py',
];
const caseNames = [
  'native-restricted-extra-source-and-stock-guest-preconditions',
  'exact-original-farm-project-accounts-and-directory-receipts',
  'new-public-only-stage-and-protected-stdin-body',
  'stock-gpg-sign-public-verify-and-decrypt',
  'unconfirmed-submission-has-no-native-admission',
  'nonzero-full-command-closes-owned-resource-and-ticket',
  'two-live-same-project-owners-have-independent-homes-and-scopes',
  'other-project-cannot-read-or-connect-to-owned-gpg-home',
  'cancel-first-confirms-descendant-and-host-physical-close',
  'second-owner-signs-after-first-close-and-quits-normally',
  'readonly-reload-keeps-closed-ticket-and-resource',
  'replaced-owned-native-source-refuses-agent-operation-before-nonce',
] as const;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const shaPattern = /^[a-f0-9]{64}$/;
/** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
 * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
/** 将输入编码成单个 POSIX shell 字面参数，嵌入单引号用结束/转义/重开方式保留原值；调用方仍负责命令和路径授权。
 * Encode input as one literal POSIX shell argument, preserving embedded quotes by closing/escaping/reopening; callers still authorize the command/path. */
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const fixed = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ';
/** 生成隔离 Python 命令，将整段源码作为单个字面参数；-I/-S 避免用户环境和 site 初始化改变观测，执行权限由外层来宾入口控制。
 * Build an isolated Python command with the source as one literal argument; -I/-S exclude user environment/site initialization, while the outer guest entry controls execution authority. */
const python = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);

const application = String.raw`import hashlib,json,os,stat,subprocess,sys,time
stage,label,mode=sys.argv[1:];assert label in ('complete','nonzero','first','second','replacement')
manifest=json.load(open(stage+'/manifest.json'));identity=manifest['identity']
def output(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,sort_keys=True);f.flush();os.fsync(f.fileno())
scope=open('/proc/self/cgroup').read().strip();run=scope.split('sakura-task-')[1]
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
ticks=open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19]
body_began={'version':1,'invocation':manifest['invocation'],'label':label,'stage':stage,
 'runId':run,'bootId':boot,'pid':os.getpid(),'ticks':ticks,'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'egid':os.getegid()}
output(stage+'/'+label+'.body-began.json',body_began)
home=os.environ['GNUPGHOME']
assert os.getuid()==os.geteuid()==identity['uid'] and os.getgid()==os.getegid()==identity['gid']
assert os.getgroups()==[] and os.getcwd()==identity['directory'] and os.environ['HOME']==identity['home']
assert home.startswith('/run/sakura-gpg-data/') and home.endswith('/home')
def info(path):
 s=os.lstat(path);return {'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'type':stat.S_IFMT(s.st_mode),'size':s.st_size}
def process(pid):
 f=open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()
 return {'pid':pid,'ticks':f[19],'state':f[0],'cgroup':open('/proc/'+str(pid)+'/cgroup').read().strip()}
def digest(path):
 s=os.lstat(path);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1
 return hashlib.sha256(open(path,'rb').read()).hexdigest()
status=dict(line.rstrip().split(':',1) for line in open('/proc/self/status') if ':' in line)
caps={k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')}
assert all(int(caps[k],16)==0 for k in caps if k!='NoNewPrivs') and caps['NoNewPrivs']=='1'
assert scope.startswith('0::/sakura-task-');network=os.stat('/proc/self/ns/net')
write_path=identity['home']+'/gpg-owned-'+manifest['invocation']+'-'+label
fd=os.open(write_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:f.write(b'owned-home-write\n')
home_write=info(write_path);os.unlink(write_path)
report={'label':label,'bodyBegan':body_began,'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'caps':caps,
 'home':os.environ['HOME'],'cwd':os.getcwd(),'gpgHome':home,'gpgHomeObject':info(home),'homeWrite':home_write,
 'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),'runId':run,'process':process(os.getpid()),
 'networkDevice':str(network.st_dev),'networkInode':str(network.st_ino),'descendants':[]}
if mode=='nonzero':
 output(stage+'/'+label+'.json',report);print(json.dumps(report,sort_keys=True));sys.exit(7)
for name in ('public.asc','payload.bin','ciphertext.gpg'):assert digest(stage+'/'+name)==manifest['files'][name]
gpg=['/usr/bin/gpg','--no-options','--no-autostart','--batch','--no-tty']
def command(args):
 p=subprocess.run(gpg+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
 assert p.returncode==0,(args,p.returncode,p.stderr.decode(errors='replace')[:4096])
 return p.stdout.decode(errors='replace')
command(['--import',stage+'/public.asc'])
listing=command(['--with-colons','--list-keys']);fingerprints=[line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:')]
assert fingerprints and all(len(f) in (40,64) for f in fingerprints)
public_home=home+'/public-only';assert len((public_home+'/S.gpg-agent').encode())<108
os.mkdir(public_home,0o700)
keyring=next(name for name in ('pubring.kbx','pubring.gpg') if os.path.lexists(home+'/'+name))
source=os.open(home+'/'+keyring,os.O_RDONLY|os.O_NOFOLLOW)
try:
 metadata=os.fstat(source);assert stat.S_ISREG(metadata.st_mode) and metadata.st_nlink==1 and metadata.st_uid==identity['uid']
 public_data=os.read(source,262145);assert 0<len(public_data)<=262144 and len(public_data)==metadata.st_size and not os.read(source,1)
 after=os.fstat(source)
 for name in ('st_dev','st_ino','st_size','st_mode','st_nlink','st_uid','st_gid','st_mtime_ns','st_ctime_ns'):assert getattr(after,name)==getattr(metadata,name)
finally:os.close(source)
destination=os.open(public_home+'/'+keyring,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 with os.fdopen(destination,'wb',closefd=False) as f:f.write(public_data);f.flush();os.fsync(f.fileno())
finally:os.close(destination)
public_listing=command(['--homedir',public_home,'--with-colons','--list-keys'])
assert [line.split(':')[9] for line in public_listing.splitlines() if line.startswith('fpr:')]==fingerprints
assert not os.path.lexists(public_home+'/S.gpg-agent') and not os.path.lexists(public_home+'/private-keys-v1.d')
def sign_verify(suffix):
 signature=stage+'/'+label+'-'+suffix+'.sig'
 command(['--local-user',fingerprints[0],'--output',signature,'--detach-sign',stage+'/payload.bin'])
 checked=command(['--homedir',public_home,'--status-fd','1','--verify',signature,stage+'/payload.bin'])
 assert not os.path.lexists(public_home+'/S.gpg-agent') and not os.path.lexists(public_home+'/private-keys-v1.d')
 valid=[line for line in checked.splitlines() if line.startswith('[GNUPG:] VALIDSIG ')]
 assert len(valid)==1 and any(f in valid[0].split() for f in fingerprints)
 return {'signatureSha256':digest(signature),'validsig':valid[0],'publicOnlyHome':info(public_home),'publicKeyringSha256':hashlib.sha256(public_data).hexdigest(),'publicOnlyAgentSocketAbsent':True}
report['fingerprints']=fingerprints;report['signature']=sign_verify('initial')
decrypted=stage+'/'+label+'.decrypted';command(['--output',decrypted,'--decrypt',stage+'/ciphertext.gpg'])
assert digest(decrypted)==manifest['files']['payload.bin'];report['decryptedSha256']=digest(decrypted)
report['publicHomeFiles']=[{'name':name,**info(home+'/'+name)} for name in sorted(os.listdir(home))]
assert any(item['name'] in ('pubring.kbx','pubring.gpg') for item in report['publicHomeFiles'])
if mode=='hold':
 child=subprocess.Popen(['/usr/bin/python3','-I','-S','-c','import os,time;os.setsid();time.sleep(300)'],stdin=subprocess.DEVNULL)
 report['descendants'].append(process(child.pid));output(stage+'/'+label+'.ready.json',report)
 deadline=time.monotonic()+180
 while not os.path.lexists(stage+'/'+label+'.finish'):
  assert time.monotonic()<deadline;time.sleep(.1)
 report['afterNeighborClose']=sign_verify('after-neighbor-close');child.terminate();child.wait(timeout=5)
output(stage+'/'+label+'.json',report);print(json.dumps(report,sort_keys=True))
`;

const observer = String.raw`import hashlib,json,os,pwd,re,stat,struct,sys
r=json.load(sys.stdin);assert r['operation'] in ('baseline','stage','report','stopped','gate','replacement','failure')
boot=open('/proc/sys/kernel/random/boot_id').read().strip();assert r.get('bootId',boot)==boot
def metadata(s):return {'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'type':stat.S_IFMT(s.st_mode),'links':s.st_nlink,'size':s.st_size}
def directory(path):
 s=os.lstat(path);assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode);return metadata(s)
def bounded(path,uid=None,limit=1048576):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=limit
  assert uid is None or s.st_uid==uid
  data=os.read(fd,limit+1);assert len(data)==s.st_size and metadata(s)==metadata(os.fstat(fd));return data,metadata(s)
 finally:os.close(fd)
def alive(p):
 try:
  f=open('/proc/'+str(p['pid'])+'/stat').read().rsplit(') ',1)[1].split();same=f[19]==p['ticks'] and f[0] not in ('Z','X')
  result={'pid':p['pid'],'ticks':p['ticks'],'alive':same,'state':f[0]}
  if same:
   result['uid']=os.stat('/proc/'+str(p['pid'])).st_uid;result['cgroup']=open('/proc/'+str(p['pid'])+'/cgroup').read().strip()
   status=dict(line.rstrip().split(':',1) for line in open('/proc/'+str(p['pid'])+'/status') if ':' in line)
   result['caps']={k:status[k].strip() for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')}
   result['uids']=status['Uid'].split();result['gids']=status['Gid'].split();result['groups']=status['Groups'].split()
   n=os.stat('/proc/'+str(p['pid'])+'/ns/net');result.update(networkDevice=str(n.st_dev),networkInode=str(n.st_ino))
  return result
 except FileNotFoundError:return {'pid':p['pid'],'ticks':p['ticks'],'alive':False,'state':'absent'}
def owned_stage():
 identity=r['identity'];stage=r['stage'];assert stage==identity['directory']+'/gpg-agent-'+r['invocation']
 original=directory(identity['directory']);assert [original['device'],original['inode']]==[identity['directoryDevice'],identity['directoryInode']]
 return identity,stage
def binding_identity(data,project):
 layout=struct.Struct('<8sIIIIQQQQQ37s17s32s37s256s1024sI577s');assert len(data)==layout.size==2048
 f=layout.unpack(data);assert f[0]==b'SKIDB001' and f[1]==1 and f[2] in (1,2) and f[16] in (0,1) and not any(f[17])
 def text(value):
  end=value.index(b'\0');assert not any(value[end:]);return value[:end].decode('utf-8')
 registry,pid,account,identity,home,folder=[text(value) for value in f[10:16]]
 assert pid==project and re.fullmatch(r'default|[a-f0-9]{16}',pid)
 for value in (registry,identity):assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value)
 assert 20000<=f[3]<=59999 and f[4]==f[3] and f[5]>0 and f[7]>0 and (f[2]!=2 or f[9]>0)
 assert account=='skp'+identity.replace('-','')[:24] and home=='/var/lib/sakura-project-homes/'+identity
 assert folder.startswith('/') and all(c and c not in ('.','..') for c in folder.split('/')[1:])
 return {'version':1,'phase':'active' if f[2]==2 else 'intent','registryId':registry,'projectId':pid,'account':account,
  'uid':f[3],'gid':f[4],'identityId':identity,'revision':f[5],'home':home,'directory':folder,
  'directoryDevice':str(f[6]),'directoryInode':str(f[7]),'homeDevice':str(f[8]),'homeInode':str(f[9]),
  'networkIsolation':'private' if f[16] else 'host'}
op=r['operation'];result={'bootId':boot}
if op=='baseline':
 files=['/etc/passwd','/etc/group','/var/lib/sakura/project-identities/registry.json']
 files+=['/var/lib/sakura/project-identities/projects/'+n for n in sorted(os.listdir('/var/lib/sakura/project-identities/projects'))]
 records={};ledger_objects={}
 for path in files:
  data,s=bounded(path);item={'metadata':s,'sha256':hashlib.sha256(data).hexdigest()}
  if path.startswith('/var/lib/sakura/project-identities/projects/') and re.fullmatch(r'(?:default|[a-f0-9]{16})\.bin',path.rsplit('/',1)[1]):
   assert s['uid']==s['gid']==0 and s['mode']==0o600 and s['type']==stat.S_IFREG and s['links']==1 and s['size']==2048
   item['identity']=binding_identity(data,path.rsplit('/',1)[1][:-4]);ledger_objects[path]=s
   item['metadata']={k:v for k,v in s.items() if k!='inode'}
   expected=next((value for value in r['identities'] if value['projectId']==item['identity']['projectId']),None)
   if expected is not None:assert item['identity']==expected
  records[path]=item
 accounts={}
 for identity in r['identities']:
  p=pwd.getpwnam(identity['account']);assert (p.pw_uid,p.pw_gid,p.pw_dir)==(identity['uid'],identity['gid'],identity['home'])
  stable=lambda value:{k:v for k,v in value.items() if k not in ('size','links')}
  accounts[identity['account']]={'uid':p.pw_uid,'gid':p.pw_gid,'home':p.pw_dir,'directory':stable(directory(identity['directory'])),'homeObject':stable(directory(identity['home']))}
 ready={}
 for root in r['readyPaths']:
  assert re.fullmatch(r'/opt/sakura-runtimes/(?:node-[0-9.]+|python-[0-9.]+|python-managed-[a-f0-9-]{36})',root)
  entries={};total=0
  for current,dirs,names in os.walk(root,followlinks=False):
   for name in ['.']+sorted(dirs+names):
    path=current if name=='.' else current+'/'+name;s=os.lstat(path);v=metadata(s);assert len(entries)<30000
    if stat.S_ISLNK(s.st_mode):v['target']=os.readlink(path)
    elif stat.S_ISREG(s.st_mode):
     assert s.st_uid==0 and not s.st_mode&0o022 and s.st_size<=134217728
     total+=s.st_size;assert total<=268435456
     with open(path,'rb') as f:v['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
    else:assert stat.S_ISDIR(s.st_mode)
    entries[os.path.relpath(path,root)]=v
  ready[root]={'sha256':hashlib.sha256(json.dumps(entries,sort_keys=True).encode()).hexdigest(),'count':len(entries),'bytes':total}
 result.update(files=records,ledgerObjects=ledger_objects,accounts=accounts,ready=ready)
elif op=='failure':
 identity,stage=owned_stage();context=r['context'];label=r['label'];assert context['identity']==identity
 assert label in ('complete','nonzero','first','second','replacement')
 run=context['owner']['runId'];lease=context['resource']['leaseId']
 for value in (run,lease):assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value)
 record_path='/run/sakura-gpg-forwards/records/'+lease+'.json';record=None
 if os.path.lexists(record_path):
  data,s=bounded(record_path,0,262144);result['record']={'path':record_path,'metadata':s,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
  try:record=json.loads(data)
  except (ValueError,UnicodeError):result['record']['jsonValid']=False
  if isinstance(record,dict) and record.get('context')==context:
   result['record']['contextMatches']=True;result['record']['value']=record
  else:result['record']['contextMatches']=False;record=None
 else:result['record']={'path':record_path,'present':False}
 roots=[('/run/sakura-gpg-forwards/sources/'+lease,'sourceDirectory'),('/run/sakura-gpg-sockets/'+lease,'endpointDirectory'),
  ('/run/sakura-gpg-data/'+lease,'homeDirectory'),('/run/sakura-gpg-data/'+lease+'/home','home')]
 result['directories']=[]
 for path,key in roots:
  row={'path':path,'role':key};result['directories'].append(row)
  if not os.path.lexists(path):row['present']=False;continue
  s=os.lstat(path);row.update(present=True,metadata=metadata(s));expected=(record or {}).get(key)
  if not stat.S_ISDIR(s.st_mode) or not expected or (str(s.st_dev),str(s.st_ino))!=(expected['device'],expected['inode']):
   row['originalObjectMatches']=False;continue
  fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   assert metadata(s)==metadata(os.fstat(fd));names=sorted(os.listdir(fd));assert len(names)<=4096
   row.update(originalObjectMatches=True,count=len(names),entryNames=names[:256],truncated=len(names)>256,
    allEntryNamesSha256=hashlib.sha256(json.dumps(names,separators=(',',':'),ensure_ascii=True).encode()).hexdigest())
  finally:os.close(fd)
 result['peers']=[]
 if record:
  for role,p in [('broker',record.get('broker')),('source-peer',(record.get('source') or {}).get('peer'))]:
   if isinstance(p,dict) and type(p.get('pid')) is int and p['pid']>1 and isinstance(p.get('startTicks'),str) and re.fullmatch(r'0|[1-9][0-9]*',p['startTicks']):
    result['peers'].append({'role':role,**alive({'pid':p['pid'],'ticks':p['startTicks']})})
 result['publicStageMarkers']=[]
 for suffix in ('.body-began.json','.json','.ready.json'):
  path=stage+'/'+label+suffix;row={'path':path};result['publicStageMarkers'].append(row)
  if not os.path.lexists(path):row['present']=False;continue
  data,s=bounded(path,identity['uid'],65536);assert s['mode']==0o600
  row.update(present=True,metadata=s,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
  try:value=json.loads(data)
  except (ValueError,UnicodeError):row['jsonValid']=False;continue
  body=value if suffix=='.body-began.json' else value.get('bodyBegan',{})
  matched=isinstance(body,dict) and body.get('invocation')==r['invocation'] and body.get('runId')==run and body.get('bootId')==context['owner']['bootId'] and body.get('uid')==body.get('euid')==identity['uid']
  row['originalInvocationMatches']=matched
  if matched:row['value']=value
elif op=='stage':
 import base64
 identity,stage=owned_stage();assert not os.path.lexists(stage);os.mkdir(stage,0o700)
 fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for name,encoded in r['files'].items():
   assert name in ('fixture.py','manifest.json','public.asc','payload.bin','ciphertext.gpg')
   data=base64.b64decode(encoded,validate=True);assert len(data)<=1048576
   out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
   try:
    with os.fdopen(out,'wb',closefd=False) as f:f.write(data);f.flush()
    os.fchown(out,identity['uid'],identity['gid']);os.fsync(out)
   finally:os.close(out)
  os.fchown(fd,identity['uid'],identity['gid']);os.fsync(fd)
 finally:os.close(fd)
 result.update(stage=stage,metadata=directory(stage))
elif op=='report':
 identity,stage=owned_stage();assert r['label'] in ('complete','nonzero','first','second','replacement')
 path=stage+'/'+r['label']+('.ready.json' if r.get('ready') else '.json')
 if not os.path.lexists(path):result['report']=None
 else:
  data,s=bounded(path,identity['uid']);assert s['mode']==0o600
  value=json.loads(data);scope='/sys/fs/cgroup/sakura-task-'+value['runId']
  body,body_metadata=bounded(stage+'/'+r['label']+'.body-began.json',identity['uid']);assert body_metadata['mode']==0o600
  marker=json.loads(body);assert marker==value['bodyBegan'] and marker['version']==1
  assert marker['invocation']==r['invocation'] and marker['label']==r['label'] and marker['stage']==stage
  assert marker['runId']==value['runId'] and marker['bootId']==value['bootId']==boot
  assert marker['uid']==marker['euid']==identity['uid'] and marker['gid']==marker['egid']==identity['gid']
  assert marker['pid']==value['process']['pid'] and marker['ticks']==value['process']['ticks']
  result.update(report=value,markerMetadata=s,bodyBeganMetadata=body_metadata,bodyBeganSha256=hashlib.sha256(body).hexdigest(),processes=[alive(p) for p in [value['process']]+value['descendants']],
   cgroupObject=directory(scope) if os.path.lexists(scope) else None)
elif op=='stopped':
 context=r['context'];run=context['owner']['runId'];lease=context['resource']['leaseId']
 assert re.fullmatch(r'[a-f0-9-]{36}',run) and re.fullmatch(r'[a-f0-9-]{36}',lease)
 paths=['/sys/fs/cgroup/sakura-task-'+run,'/run/sakura-guest-tasks/'+run,
  '/run/sakura-gpg-forwards/sources/'+lease,'/run/sakura-gpg-sockets/'+lease,'/run/sakura-gpg-data/'+lease]
 result.update(paths=[{'path':p,'exists':os.path.lexists(p)} for p in paths],processes=[alive(p) for p in r.get('processes',[])])
elif op=='gate':
 identity,stage=owned_stage();assert r['label']=='second'
 fd=os.open(stage+'/'+r['label']+'.finish',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:os.write(fd,b'owned finish\n');os.fchown(fd,identity['uid'],identity['gid']);os.fsync(fd)
 finally:os.close(fd)
 result['released']=True
elif op=='replacement':
 identity,stage=owned_stage();assert r['label']=='replacement'
 data,s=bounded(stage+'/replacement.body-began.json',identity['uid']);assert s['mode']==0o600
 marker=json.loads(data);context=r['context'];assert context['identity']==identity
 assert marker['version']==1 and marker['invocation']==r['invocation'] and marker['label']=='replacement' and marker['stage']==stage
 assert marker['runId']==context['owner']['runId'] and marker['bootId']==context['owner']['bootId']==boot
 assert marker['uid']==marker['euid']==identity['uid'] and marker['gid']==marker['egid']==identity['gid']
 assert isinstance(marker['pid'],int) and marker['pid']>0 and re.fullmatch('[0-9]+',marker['ticks'])
 outputs=['replacement-initial.sig','replacement-after-neighbor-close.sig','replacement.decrypted','replacement.json']
 absent=[{'path':stage+'/'+name,'exists':os.path.lexists(stage+'/'+name)} for name in outputs]
 assert all(not item['exists'] for item in absent)
 result.update(bodyBegan=marker,markerMetadata=s,markerSha256=hashlib.sha256(data).hexdigest(),outputs=absent)
print(json.dumps(result,sort_keys=True))
`;

type Setup = { workspace: string; parent: string; root: string; vmId: string; distro: Distro;
  machineDirectory: string; record: any; farm: any; freezeFile: string; freezeBytes: Buffer; freeze: any;
  pins: Record<InputName, Pin>; ownedHostRoot: string; ownedHostRootPin: HostRootPin;
  ownedHostMarker: { path: string; sha256: string }; files: Map<string, string>;
  bootGuardBefore: { file: string; sha256: string; state: { attempts: number[] } };
  runtimeFiles: { qemu: FileDigest; disk: FileDigest; seed: FileDigest; sshPrivate: FileDigest };
  oldJournals: Map<string, any>; exactQemu: /** 返回命令行精确引用本夹具磁盘的 QEMU 数量，用于证明自有实例启动/关闭，不以工具名称匹配替代资源归属。
 * Return the number of QEMU processes whose argv exactly references this fixture disk, proving owned-VM start/closure without replacing resource ownership with executable-name matching. */ () => number; secretDirectory: string };

/** 要求目标是给定根的非空子路径，拒绝绝对相对结果和上级逃逸；只验证路径归属，不跟随链接授权。
 * Require a nonempty child path under the root and reject absolute-relative results/parent escape; lexical containment alone does not authorize followed links. */
function inside(root: string, path: string) {
  const part = relative(root, path); assert.ok(part && !part.startsWith('..') && !isAbsolute(part));
}
/** 核验精确 realpath、普通文件、无链接、单硬链接及大小预算，返回 lstat 元数据作为后续 FD pin。
 * Check exact realpath/regular file/no symlink/single hard link/size budget and return lstat metadata for subsequent FD pinning. */
async function ordinaryFile(file: string, maximum = 16 * 1024 * 1024) {
  assert.equal(await realpath(file), file); const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= maximum); return info;
}
/** 打开后用 fstat 绑定前置 dev/ino/size/mtime，再流式摘要并复核长度/时间；读取中替换或超预算拒绝，finally 关闭句柄。
 * Bind opened fstat to preflight dev-ino-size-mtime, stream hashes/recheck size-time and reject replacement/oversize, closing the handle in finally. */
async function fileDigest(path: string, maximum: number): Promise<FileDigest> {
  const before = await ordinaryFile(path, maximum), handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    assert.ok(opened.isFile() && opened.nlink === 1); assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino);
    assert.equal(opened.size, before.size); assert.equal(opened.mtimeMs, before.mtimeMs);
    const digest = createHash('sha256'); let count = 0;
    for await (const bytes of handle.createReadStream({ autoClose: false })) { count += bytes.length; assert.ok(count <= maximum); digest.update(bytes); }
    const after = await handle.stat(); assert.equal(count, opened.size); assert.equal(after.size, opened.size); assert.equal(after.mtimeMs, opened.mtimeMs);
    return { path, sha256: digest.digest('hex'), bytes: count, device: opened.dev, inode: opened.ino, mtimeMs: opened.mtimeMs };
  } finally { await handle.close(); }
}
/** lstat 必须 ENOENT，其他错误传播；未知启动事务已存在则拒绝，避免本轮覆盖或恢复非自有状态。
 * Require lstat ENOENT/propagate other errors; reject existing unknown startup transactions rather than overwrite/recover foreign state. */
async function mustBeAbsent(path: string) {
  const found = await lstat(path).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; });
  assert.equal(found, false, 'An unknown existing startup transaction is not authorized: ' + path);
}
/** 读取 Windows 目录 ACL 和物理对象 pin，拒绝非当前用户/System/Administrators 的有效授权，返回只读安全证据而不修复权限。
 * Read Windows directory ACL/physical-object pins, reject effective access beyond current user/System/Administrators and return read-only evidence without repairing permissions. */
function readonlyHostRoot(root: string) {
  // GetAccessControl and GetAttributes are read-only. No Add-Type/native guard is used
  // during offline validation; the native 128-bit FileID is checked at capture.
  const script = String.raw`$ErrorActionPreference='Stop'
$gpgRootRequest=[Console]::In.ReadToEnd()|ConvertFrom-Json
$gpgRootSecurity=[IO.Directory]::GetAccessControl($gpgRootRequest.path)
$gpgRootDescriptor=[Security.AccessControl.RawSecurityDescriptor]::new($gpgRootSecurity.GetSecurityDescriptorBinaryForm(),0)
if($null -eq $gpgRootDescriptor.DiscretionaryAcl){throw 'GPG_TEST_ROOT_DACL_ABSENT'}
$gpgRootAclBytes=New-Object byte[] $gpgRootDescriptor.DiscretionaryAcl.BinaryLength
$gpgRootDescriptor.DiscretionaryAcl.GetBinaryForm($gpgRootAclBytes,0)
$gpgRootAlgorithm=[Security.Cryptography.SHA256]::Create()
try{$gpgRootAclSha=([BitConverter]::ToString($gpgRootAlgorithm.ComputeHash($gpgRootAclBytes))).Replace('-','').ToLowerInvariant()}finally{$gpgRootAlgorithm.Dispose()}
$gpgRootSelf=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($gpgRootRule in $gpgRootSecurity.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
 if($gpgRootRule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly){continue}
 if($gpgRootRule.AccessControlType -eq 'Allow' -and [int64]$gpgRootRule.FileSystemRights -and @($gpgRootSelf,'S-1-5-18','S-1-5-32-544') -notcontains $gpgRootRule.IdentityReference.Value){throw 'GPG_TEST_ROOT_NOT_PRIVATE'}
}
@{owner=$gpgRootSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value;aclSha256=$gpgRootAclSha;
 attributes=[uint32][IO.File]::GetAttributes($gpgRootRequest.path);protectedAcl=$gpgRootSecurity.AreAccessRulesProtected;currentSid=$gpgRootSelf}|ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { input: JSON.stringify({ path: root }), encoding: 'utf8', windowsHide: true, timeout: 10000 }));
}
/** 核对参数/发行版/平台、精确 Farm 根与新冻结戳、HEAD/资源摘要及原停机证据；validate-only 只检验，显式 reuse-existing 才进入运行。
 * Validate arguments/distribution/platform/exact Farm root/new freeze stamp/HEAD-assets/prior stopped evidence; validate-only observes and explicit reuse-existing permits execution. */
async function validate(args: string[]): Promise<Setup> {
  const [distroInput, fixtureInput, freezeInput, mode = '--validate-only'] = args;
  assert.ok(args.length === 3 || args.length === 4,
    'Use <alpine|debian|ubuntu> <exact-farm-fixture> <new-gpg-freeze-UUID.json> [--validate-only|--reuse-existing].');
  assert.ok(Object.hasOwn(fixtures, distroInput)); assert.ok(['--validate-only', '--reuse-existing'].includes(mode));
  assert.equal(process.platform, 'win32'); assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  const distro = distroInput as Distro, selected = fixtures[distro];
  const workspace = await realpath(resolve('.')), parent = await realpath(join(workspace, '.data/network-remaining-test-temp'));
  const root = await realpath(resolve(fixtureInput)); assert.equal(dirname(root), parent); assert.equal(basename(root), selected.name);
  const freezeFile = await realpath(resolve(freezeInput)); assert.equal(dirname(freezeFile), parent);
  assert.match(basename(freezeFile), /^gpg-agent-project-identity-freeze-[a-f0-9-]{36}\.json$/);
  await ordinaryFile(freezeFile); const freezeBytes = await readFile(freezeFile), freeze = JSON.parse(freezeBytes.toString('utf8'));
  assert.equal(freeze.version, 1); assert.equal(freeze.frozen, true);
  assert.equal(freeze.head, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim());
  const files = new Map<string, string>();
  /** 核验普通单链接文件并可比对预定摘要，登记内容哈希后返回字节，供冻结来源与历史保留。
   * Validate a regular single-link file/optional pinned hash, retain its digest and return bytes for frozen sources/history preservation. */
  const remember = async (file: string, expected?: string) => {
    await ordinaryFile(file); const bytes = await readFile(file), digest = hash(bytes);
    if (expected !== undefined) { assert.match(expected, shaPattern); assert.equal(digest, expected, file); }
    files.set(file, digest); return bytes;
  };
  assert.deepEqual(Object.keys(freeze.sourceSha256).sort(), [...requiredSources].sort());
  for (const name of requiredSources) await remember(join(workspace, name), freeze.sourceSha256[name]);
  assert.deepEqual(Object.keys(freeze.assetSha256).sort(), [...requiredAssets].sort());
  for (const name of requiredAssets) await remember(join(workspace, name), freeze.assetSha256[name]);
  const brokerManifest = JSON.parse(await readFile(join(workspace, '.sakura-server/assets/gpg-agent/manifest.json'), 'utf8'));
  assert.equal(brokerManifest.sha256, freeze.sourceSha256['server/gpg-agent-broker.py']);
  assert.equal(brokerManifest.sha256, freeze.assetSha256['.sakura-server/assets/gpg-agent/broker.py']);
  const hostManifest = JSON.parse(await readFile(join(workspace, '.sakura-server/assets/gpg-agent-host/manifest.json'), 'utf8'));
  assert.equal(hostManifest.sha256, freeze.assetSha256['.sakura-server/assets/gpg-agent-host/relay.exe']);
  assert.equal(hostManifest.sourceSha256, freeze.sourceSha256['native/gpg-agent/windows-relay.cpp']);
  assert.equal(hostManifest.sourceSha256, freeze.assetSha256['.sakura-server/assets/gpg-agent-host-source.cpp']);
  const identityManifest = JSON.parse(await readFile(join(workspace, '.sakura-server/assets/project-identity/manifest.json'), 'utf8'));
  const identityBuild = createHash('sha256');
  assert.deepEqual(identityManifest.files.map((file: any) => file.name), ['protocol.h', 'launcher.c', 'controller.py']);
  for (const file of identityManifest.files) {
    const sourceName = 'native/project-identity/' + file.name, assetName = '.sakura-server/assets/project-identity/' + file.name;
    assert.equal(file.sha256, freeze.sourceSha256[sourceName]); assert.equal(file.sha256, freeze.assetSha256[assetName]);
    const bytes = await readFile(join(workspace, assetName)); assert.equal(bytes.length, file.size); identityBuild.update(file.name).update(bytes);
  }
  assert.equal(identityBuild.digest('hex'), identityManifest.build);
  const dataDirectory = join(workspace, '.data'); assert.equal(await realpath(dataDirectory), dataDirectory);
  assert.equal(freeze.ownedHostRoot, resolve(freeze.ownedHostRoot));
  const ownedHostRoot = await realpath(freeze.ownedHostRoot); assert.equal(ownedHostRoot, freeze.ownedHostRoot);
  assert.equal(dirname(ownedHostRoot), dataDirectory); assert.match(basename(ownedHostRoot), /^[a-f0-9]{32}$/);
  const rootInfo = await lstat(ownedHostRoot); assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink());
  const ownedHostRootPin = freeze.ownedHostRootPin as HostRootPin;
  assert.deepEqual(Object.keys(ownedHostRootPin).sort(), ['id', 'owner', 'aclSha256', 'attributes', 'links', 'directory', 'protectedAcl'].sort());
  assert.match(ownedHostRootPin.id, /^[a-f0-9]{1,16}:[a-f0-9]{32}$/); assert.match(ownedHostRootPin.owner, /^S-1-\d+(?:-\d+)+$/);
  assert.match(ownedHostRootPin.aclSha256, shaPattern); assert.ok(Number.isSafeInteger(ownedHostRootPin.attributes));
  assert.ok(ownedHostRootPin.attributes >= 0 && ownedHostRootPin.attributes <= 0xffffffff);
  assert.ok((ownedHostRootPin.attributes & 16) !== 0 && (ownedHostRootPin.attributes & 0x004c1400) === 0);
  assert.equal(ownedHostRootPin.links, rootInfo.nlink); assert.equal(ownedHostRootPin.directory, true); assert.equal(ownedHostRootPin.protectedAcl, true);
  const rootSecurity = readonlyHostRoot(ownedHostRoot);
  assert.equal(rootSecurity.owner, rootSecurity.currentSid); assert.equal(rootSecurity.owner, ownedHostRootPin.owner);
  assert.equal(rootSecurity.aclSha256, ownedHostRootPin.aclSha256); assert.equal(rootSecurity.attributes, ownedHostRootPin.attributes);
  assert.equal(rootSecurity.protectedAcl, true);
  const ownedHostMarker = freeze.ownedHostMarker as { path: string; sha256: string };
  assert.deepEqual(Object.keys(ownedHostMarker).sort(), ['path', 'sha256']);
  assert.equal(ownedHostMarker.path, join(ownedHostRoot, 'host-owned-marker.json'));
  assert.match(ownedHostMarker.sha256, shaPattern); await ordinaryFile(ownedHostMarker.path, 16384);
  const marker = JSON.parse((await remember(ownedHostMarker.path, ownedHostMarker.sha256)).toString('utf8'));
  assert.equal(marker.version, 1); assert.equal(marker.kind, 'sakura-gpg-host-test'); assert.match(marker.uuid, uuidPattern);
  assert.equal(marker.uuid.replaceAll('-', ''), basename(ownedHostRoot)); assert.equal(marker.ownedHostRoot, ownedHostRoot);
  assert.ok(Number.isSafeInteger(marker.createdByNodePid) && marker.createdByNodePid > 0);
  assert.ok(['', '0', '1'].includes(process.env.SAKURA_AGENT_PRIVATE || ''));
  assert.deepEqual(Object.keys(freeze.testInputs).sort(), [...inputNames].sort());
  const pins = {} as Record<InputName, Pin>;
  for (const name of inputNames) {
    const provided = process.env['SAKURA_GPG_TEST_' + name]; assert.ok(provided, 'Missing explicit test input: ' + name);
    assert.equal(provided, resolve(provided)); const path = await realpath(provided); assert.equal(path, provided); inside(ownedHostRoot, path);
    const info = await ordinaryFile(path, name === 'SOURCE' ? 4096 : 16384);
    const sha256 = process.env['SAKURA_GPG_TEST_' + name + '_SHA256'] || ''; assert.match(sha256, shaPattern);
    assert.equal(freeze.testInputs[name].path, path); assert.equal(freeze.testInputs[name].sha256, sha256);
    // Native Windows socket files contain the authentication nonce. Only the
    // native helper reads/pins that file. Node never reads, logs or copies it.
    const bytes = name === 'SOURCE' ? undefined : await remember(path, sha256);
    if (name === 'PUBLIC') {
      const armor = bytes!.toString('utf8'); assert.ok(armor.trimStart().startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----'));
      assert.ok(armor.trimEnd().endsWith('-----END PGP PUBLIC KEY BLOCK-----')); assert.ok(!armor.includes('PRIVATE KEY'));
    }
    pins[name] = { path, sha256, size: info.size, ...(bytes ? { bytes } : {}) };
  }
  const farm = JSON.parse((await remember(join(root, selected.proof), selected.sha256)).toString('utf8'));
  assert.equal(farm.passed, true); assert.equal(farm.phase, 'finished'); assert.equal(farm.fixture, root);
  assert.equal(farm.vmId, selected.id); assert.equal(farm.distro, distro); assert.deepEqual(farm.cleanupErrors, []);
  assert.equal(farm.projectPair.alpha.id, selected.alpha); assert.equal(farm.projectPair.beta.id, selected.beta);
  const records = JSON.parse((await readFile(join(root, 'machines.json'))).toString('utf8'));
  assert.equal(records.length, 1); const record = records[0]; assert.equal(record.id, selected.id); assert.equal(record.distro, distro);
  assert.equal(record.bootstrapped, true); assert.equal(record.sandbox, undefined); assert.equal(record.haPromotion, undefined);
  assert.equal(record.haRetirement, undefined); assert.equal(record.liveMigrationOrigin, undefined);
  for (const flag of ['diskEncryption', 'pendingResize', 'rescueOf', 'migrationOrigin', 'liveMigrationFence', 'haWitnessEnrollment', 'lastError', 'hardware'])
    assert.equal(record[flag], undefined, 'This reuse fixture has an unknown startup operation: ' + flag);
  assert.ok(record.architecture === undefined || record.architecture === 'x86_64');
  assert.ok(record.firmware === undefined || record.firmware === 'bios'); assert.ok(['auto', 'tcg'].includes(record.accelerator));
  assert.ok(record.storagePoolId === undefined || record.storagePoolId === 'default'); assert.deepEqual(record.forwards, []);
  const machineDirectory = await realpath(join(root, 'machines', selected.id));
  assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
  for (const name of ['identity.json', '.disk-encryption.pending.json', '.disk.encrypting.qcow2', '.disk.before-encrypt.qcow2'])
    await mustBeAbsent(join(machineDirectory, name));
  const bootGuardFile = join(machineDirectory, 'boot-guard.json');
  const bootGuardBytes = await remember(bootGuardFile);
  const bootGuardState = JSON.parse(bootGuardBytes.toString('utf8'));
  assert.deepEqual(Object.keys(bootGuardState), ['attempts']);
  assert.ok(Array.isArray(bootGuardState.attempts) && bootGuardState.attempts.length <= 100);
  assert.ok(bootGuardState.attempts.every((at: unknown) => Number.isSafeInteger(at) && Number(at) >= 0));
  const bootGuardBefore = { file: bootGuardFile, sha256: hash(bootGuardBytes), state: bootGuardState };
  // Normal Machines.start/watchBoot owns this mutable runtime record. Keep its
  // actual before/after receipts separately from immutable fixture evidence.
  files.delete(bootGuardFile);
  const qemuFile = join(workspace, '.tools/qemu/qemu-system-x86_64.exe');
  if (process.env.SAKURA_QEMU_DIR) assert.equal(resolve(process.env.SAKURA_QEMU_DIR), dirname(qemuFile));
  const runtimeFiles = {
    qemu: await fileDigest(qemuFile, 128 * 1024 * 1024),
    disk: await fileDigest(join(machineDirectory, 'disk.qcow2'), Number.MAX_SAFE_INTEGER),
    seed: await fileDigest(join(machineDirectory, 'seed.iso'), 16 * 1024 * 1024),
    // This original SSH key is hashed for preservation. Its bytes are neither
    // included in evidence nor copied to any new test file.
    sshPrivate: await fileDigest(join(machineDirectory, 'id_rsa'), 16384),
  };
  for (const pin of [runtimeFiles.qemu, runtimeFiles.seed, runtimeFiles.sshPrivate]) files.set(pin.path, pin.sha256);
  /** 按 QEMU 可执行文件名和本夹具根目录/实例参数精确筛选主机进程，返回观测数量；该数量是残留证据，不赋予终止其他进程的权限。
   * Count host processes matching QEMU executable names and this fixture’s root/VM arguments; the count is residue evidence and grants no authority to terminate other processes. */
  const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$gpgFixture='" + root.replaceAll("'", "''") + "';$gpgVm='" + selected.id + "';@(" +
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'sakura-qemu.exe' -or $_.Name -like 'qemu-system-*.exe') -and " +
    "$_.CommandLine -and $_.CommandLine.Contains($gpgFixture) -and $_.CommandLine.Contains($gpgVm) }).Count"],
  { encoding: 'utf8', windowsHide: true }).trim());
  assert.equal(exactQemu(), 0, 'This exact old fixture is running; takeover is not authorized.');
  /** 递归冻结普通历史文件，拒绝链接或非普通对象，登记摘要供结束核对。
   * Recursively pin ordinary historical files, reject links/nonregular objects and retain hashes for final comparison. */
  const snapshot = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false); const file = join(directory, entry.name);
      if (entry.isDirectory()) await snapshot(file); else { assert.ok(entry.isFile()); await remember(file); }
    }
  };
  for (const name of await readdir(root)) if (/\.json$/.test(name) && name !== 'machines.json') await remember(join(root, name));
  const oldJournals = new Map<string, any>(), journalDirectory = join(machineDirectory, 'project-identities');
  for (const entry of await readdir(journalDirectory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false); const file = join(journalDirectory, entry.name);
    if (entry.isDirectory()) await snapshot(file);
    else {
      assert.match(entry.name, /^(default|[a-f0-9]{16})\.json$/);
      const journal = JSON.parse((await readFile(file)).toString('utf8'));
      assert.ok(journal.runs.every((run: any) => run.phase === 'closed'), 'An old unresolved run cannot be adopted or recovered.');
      assert.equal(journal.pending, null); assert.ok(!journal.networkRelease || journal.networkRelease.phase === 'released');
      oldJournals.set(entry.name.slice(0, -5), journal);
    }
  }
  // Workspaces constructs the ordinary projects Jobs reader before it can be
  // replaced. A running/truncated history would be rewritten by that reader.
  const jobsDirectory = join(root, 'jobs'); assert.equal(await realpath(jobsDirectory), jobsDirectory);
  const oldProjectsHistory = JSON.parse(await readFile(join(jobsDirectory, 'projects.json'), 'utf8'));
  assert.ok(Array.isArray(oldProjectsHistory) && oldProjectsHistory.length <= 200 && oldProjectsHistory.every(value => value.status !== 'running'));
  await snapshot(jobsDirectory);
  await remember(join(machineDirectory, 'projects.json'));
  for (const kind of ['alpha', 'beta'] as const) {
    const pair = farm.projectPair[kind];
    const raw = JSON.parse((await remember(join(machineDirectory, 'project-' + pair.id + '.json'))).toString('utf8'));
    assert.equal(hash(JSON.stringify(raw)), pair.configVersion); assert.equal(raw.directory, pair.identity.directory);
    assert.equal(raw.networkIsolation, 'private'); assert.deepEqual(oldJournals.get(pair.id)?.identity, pair.identity);
  }
  for (const pin of farm.previousEvidence.files) {
    inside(parent, pin.file);
    if (pin.file !== bootGuardFile) await remember(pin.file, pin.sha256);
  }
  const farmScope = await realpath(farm.hostScope); assert.equal(dirname(farmScope), root);
  assert.equal(basename(farmScope), 'build-farm-owned-' + farm.invocation);
  const secretDirectory = join(farmScope, 'secrets'); if (distro !== 'alpine') await snapshot(secretDirectory);
  for (const entry of await readdir(machineDirectory, { withFileTypes: true }))
    if (entry.isFile() && /^project(?:-|\.)/.test(entry.name) && !files.has(join(machineDirectory, entry.name)))
      await remember(join(machineDirectory, entry.name));
  return { workspace, parent, root, vmId: selected.id, distro, machineDirectory, record, farm,
    freezeFile, freezeBytes, freeze, pins, ownedHostRoot, ownedHostRootPin, ownedHostMarker, runtimeFiles,
    files, oldJournals, exactQemu, secretDirectory, bootGuardBefore };
}

/** 建立最小自有 QEMU 适配器，仅允许一次冻结原实例启动；工具/驱动器/事务逐项核验，未知能力 fail closed，所有子进程必须实际关闭。
 * Create a minimal owned-QEMU adapter allowing one frozen original boot; verify tools/drives/transactions, fail closed on unknown capabilities and require physical child closure. */
function testOnlyEngine(setup: Setup, proof: any, diskOptions: string): Engine {
  const children = new Map<ChildProcess, { closed: Promise<void>; receipt: any }>(); let launched = false;
  /** 显式拒绝夹具没有授权的运行时能力，使意外走入其他主机操作立即失败，不能静默用替身绕过生产路径。
   * Explicitly reject runtime capabilities not authorized by this fixture so accidental host operations fail immediately instead of silently bypassing production paths with a substitute. */
  const unsupported = () => { throw new Error('An unknown test-only runtime operation is not authorized.'); };
  const runtimeOwner = new Proxy({ /** 终止此适配器登记的全部自有子进程并等待实际关闭 Promise；存在总期限时届满失败且清理计时器，不把 kill 调用等同于完成。
 * Terminate all owned children registered by this adapter and await actual closure promises; where bounded, expiry fails and clears the timer, since calling kill is not completion. */ close: async () => {
    for (const [child, owner] of children) { owner.receipt.runtimeCloseRequested = true; child.kill(); }
    const outstanding = Promise.all([...children.values()].map(owner => owner.closed));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([outstanding, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned QEMU actual close was not observed.')), 10000); })]); }
    finally { clearTimeout(timer); }
    assert.equal(children.size, 0);
  } }, { /** 仅返回夹具显式定义的成员，未知属性立即拒绝，防止 Proxy 静默提供其他运行时能力。
 * Return only members explicitly defined by the fixture and reject unknown properties so the Proxy cannot silently supply other runtime capabilities. */ get(target, key) { if (key === 'close') return target.close; return unsupported(); } });
  /** 只准一次固定原磁盘/seed 的 QEMU，核验工具摘要、启动 flags 与未知事务缺席；显式记录 Ubuntu 夹具时钟调整并绑定实际 child/取消关闭证据。
   * Allow one QEMU boot of fixed original disk/seed, verifying tool hashes/flags/absent unknown transactions; explicitly record Ubuntu fixture-clock adjustments and bind actual child/cancellation-close evidence. */
  const run: Engine['run'] = async (tool, args, options = {}) => {
    assert.equal(tool, 'sakura-qemu'); assert.equal(launched, false, 'Only one exact original VM may be launched.');
    options.signal?.throwIfAborted();
    /** 转义正则表达式的元字符，按字面匹配夹具路径或标记，避免名称被解释为匹配规则。
     * Escape regular-expression metacharacters so fixture paths/markers match literally rather than act as pattern syntax. */
    const escape = (value: string) => value.replaceAll(',', ',,');
    const drives = args.flatMap((argument, index) => argument === '-drive' ? [args[index + 1]] : []);
    assert.deepEqual(drives, [
      `file=${escape(setup.runtimeFiles.disk.path)},if=virtio,id=sakura-disk,format=qcow2,${diskOptions}`,
      `file=${escape(setup.runtimeFiles.seed.path)},${setup.distro === 'alpine' ? 'media=cdrom' : 'if=virtio,format=raw'},readonly=on`,
    ]);
    assert.equal(args[args.indexOf('-name') + 1], 'sakura-' + setup.record.name);
    assert.equal(args[args.indexOf('-accel') + 1], 'tcg,thread=single'); assert.ok(args.includes('-no-reboot'));
    for (const flag of ['-S', '-snapshot', '-blockdev', '-incoming', '-object', '-kernel', '-initrd', '-readconfig']) assert.ok(!args.includes(flag));
    for (const name of ['identity.json', '.disk-encryption.pending.json', '.disk.encrypting.qcow2', '.disk.before-encrypt.qcow2'])
      await mustBeAbsent(join(setup.machineDirectory, name));
    assert.equal(setup.exactQemu(), 0);
    for (const pin of Object.values(setup.runtimeFiles)) assert.deepEqual(await fileDigest(pin.path, Number.MAX_SAFE_INTEGER), pin);
    options.signal?.throwIfAborted(); launched = true;
    const executedArgs = [...args];
    if (setup.distro === 'ubuntu') {
      const clock = executedArgs.indexOf('-icount'); assert.ok(clock >= 0);
      assert.equal(executedArgs[clock + 1], 'shift=auto,sleep=on');
      assert.equal(executedArgs.lastIndexOf('-icount'), clock);
      executedArgs.splice(clock, 2);
      executedArgs[executedArgs.indexOf('-accel') + 1] = 'tcg,thread=multi';
    }
    const receipt: any = { argvSha256: hash(JSON.stringify(executedArgs)), requestedArgvSha256: hash(JSON.stringify(args)),
      testOnlyExecution: setup.distro === 'ubuntu' ? 'multi-threaded TCG without icount' : 'original single-threaded TCG with icount',
      startedAt: new Date().toISOString(), executable: setup.runtimeFiles.qemu.path,
      executableSha256: setup.runtimeFiles.qemu.sha256, originalDisk: setup.runtimeFiles.disk, originalSeed: setup.runtimeFiles.seed,
      accelerator: 'tcg', testOnlyHarness: true, pid: null, spawned: false, actualExit: null, actualClose: false,
      exitCode: null, signal: null, stdoutEnded: false, stdoutClosed: false, stderrEnded: false, stderrClosed: false, settled: false };
    proof.qemuExecutions.push(receipt);
    const child = spawn(setup.runtimeFiles.qemu.path, executedArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    /** 由实际 child close 事件兑现关闭 Promise，供运行时撤销等待，不能由 kill/exit 请求提前兑现。
     * Resolve the closure promise from actual child close for runtime retirement, never prematurely from kill/exit requests. */
    let closedResolve!: () => void; const closed = new Promise<void>(yes => { closedResolve = yes; });
    children.set(child, { closed, receipt });
    child.once('spawn', () => { receipt.spawned = true; receipt.pid = child.pid; });
    child.once('exit', (code, signal) => { receipt.actualExit = { code, signal, at: new Date().toISOString() }; });
    let spawnError: Error | undefined, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    child.once('error', error => { spawnError = error; receipt.spawnError = error.message; });
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']] as const) stream!.on('data', (bytes: Buffer) => {
      options.output?.(bytes); const content = name === 'stdout' ? stdout : stderr;
      const next = Buffer.concat([content, bytes]).subarray(-65536); if (name === 'stdout') stdout = next; else stderr = next;
    });
    /** 取消只绑定当前自有 child 句柄，终止该进程；存在 receipt/entry 时同时记录取消证据，实际 close 仍由外层等待。
     * Bind cancellation only to the current owned child and terminate it, recording receipt/entry evidence when present; outer code still awaits physical close. */
    const abort = () => { receipt.abortRequested = true; child.kill(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) timer = setTimeout(() => { receipt.timeoutRequested = true; child.kill(); }, options.timeoutMs);
    child.once('close', (code, signal) => {
      receipt.actualClose = true; receipt.exitCode = code; receipt.signal = signal; receipt.finishedAt = new Date().toISOString();
      receipt.stdoutEnded = child.stdout!.readableEnded; receipt.stdoutClosed = child.stdout!.closed;
      receipt.stderrEnded = child.stderr!.readableEnded; receipt.stderrClosed = child.stderr!.closed;
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); children.delete(child); closedResolve();
    });
    if (options.signal?.aborted) abort();
    try {
      await closed;
      if (spawnError) throw spawnError;
      if (options.signal?.aborted) return '';
      if (receipt.exitCode !== 0 || receipt.signal) throw new Error('Owned QEMU exited: ' + receipt.exitCode + ' ' + receipt.signal + ' ' + stderr.toString('utf8'));
      return stdout.toString('utf8');
    } finally { receipt.settled = true; }
  };
  // No PosixLoom manager or service is constructed. Any other runtime method,
  // status/image operation or availability probe fails instead of launching.
  const value = { runtime: runtimeOwner, run, runStatus: unsupported, version: 'test-only direct-spawn Engine; no version probe',
    whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
    /** 拒绝通用 service 访问，维持此夹具只允许明确 QEMU 启动的最小运行时边界。
     * Reject generic service access, preserving the fixture’s minimum runtime boundary of explicitly permitted QEMU launch only. */
    get service() { return unsupported(); } };
  return new Proxy(value, { /** 仅返回夹具显式定义的成员，未知属性立即拒绝，防止 Proxy 静默提供其他运行时能力。
 * Return only members explicitly defined by the fixture and reject unknown properties so the Proxy cannot silently supply other runtime capabilities. */ get(target, key) { if (Object.hasOwn(target, key)) return Reflect.get(target, key); return unsupported(); } }) as unknown as Engine;
}

/** 使用原 Farm 身份、stock GnuPG 和原生 Windows extra 传输验证签名/解密、保护正文、资源替换拒绝与取消清理；所有原始返回和 helper 物理关闭留证，finally 比较历史基线。
 * Use original Farm identities/stock GnuPG/native Windows extra transport to verify signing-decryption/protected bodies/replacement denial/cancellation cleanup; retain raw-result/helper-close evidence and compare historical baselines in finally. */
async function runSmoke(setup: Setup) {
  const invocation = randomUUID(), canary = 'gpg-protected-body-' + invocation;
  const proofFile = join(setup.root, 'gpg-agent-project-identity-evidence-' + invocation + '.json');
  const logFile = join(setup.parent, 'gpg-agent-project-identity-' + setup.distro + '-' + invocation + '.log');
  const exitFile = join(setup.parent, 'gpg-agent-project-identity-' + setup.distro + '-' + invocation + '-exit.json');
  const hostScope = join(setup.root, 'gpg-agent-owned-' + invocation);
  const proof: any = { version: 1, invocation, distro: setup.distro, vmId: setup.vmId, fixture: setup.root,
    startedAt: new Date().toISOString(), passed: false, phase: 'initializing', expectedCases: caseNames.length,
    client: { pid: process.pid, node: process.version, execArgv: process.execArgv },
    frozenStamp: { file: setup.freezeFile, sha256: hash(setup.freezeBytes) }, sourceSha256: setup.freeze.sourceSha256,
    assetSha256: setup.freeze.assetSha256,
    ownedHostRoot: setup.ownedHostRoot, ownedHostRootPin: setup.ownedHostRootPin, ownedHostMarker: setup.ownedHostMarker,
    testInputs: Object.fromEntries(inputNames.map(name => [name, { path: setup.pins[name].path, sha256: setup.pins[name].sha256 }])),
    previousEvidence: { farmProof: join(setup.root, fixtures[setup.distro].proof), sha256: fixtures[setup.distro].sha256,
      files: [...setup.files].map(([file, sha256]) => ({ file, sha256 })) },
    runtimeAPI: 'runGpgAgentForward', scope: 'Existing sealed Farm accounts; source identity/GPG runtime; test-only VM startup Engine; stock guest GnuPG; native Windows extra transport.',
    startupHarness: { kind: 'test-only-direct-spawn-tcg', originalRuntimeInputs: setup.runtimeFiles, whpxProbe: false,
      posixloomRuntimeConstructed: false, startupSubstitutions: [], unknownStartupOperations: 'refused',
      boundary: 'Only the VM startup engine, Ubuntu test-only multi-threaded TCG clock, exact known Alpine readiness command and test-only SSH handshake budget are substituted; product readiness checks and boot deadline remain unchanged.' },
    normalBootGuardRuntime: { before: setup.bootGuardBefore },
    privateKey: 'No private-key file is read or copied. The explicit portable test Agent is managed outside this script.',
    newAccountsClaimed: false, newMigrationsClaimed: false, cases: [], cleanupErrors: [], qemuExecutions: [], rootCommands: [],
    atomicLedgerTransitions: [], failureObservations: [],
    logFile, exitFile, proofFile, hostScope };
  const log = await open(logFile, 'wx'); await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  process.once('exit', code => writeFileSync(exitFile, JSON.stringify({ version: 1, invocation, actualExitCode: code,
    proofFile, logFile, proofSha256: hash(JSON.stringify(proof, null, 2) + '\n'), client: proof.client, at: new Date().toISOString() }) + '\n', { flag: 'wx' }));
  /** 将保护正文或秘密标记替换为固定占位后返回文本，供本夹具日志和错误证据使用；原任务输入不被修改。
   * Replace protected body/secret markers with fixed placeholders for fixture logs/error evidence without mutating actual task input. */
  const mask = (value: unknown) => String(value).replaceAll(canary, '[owned body]');
  /** 将当前完整验收证据写入专用 proofFile，返回写入 Promise；失败传播，避免只在内存中标记通过。
   * Write the complete current verification evidence to its dedicated proofFile and return the write promise; failures propagate rather than mark an in-memory-only pass. */
  const persist = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  /** 先脱敏再将同一条结论写入本轮日志与控制台，等待日志写入完成，保留真实写入错误。
   * Redact and write the same result to the run log/console, awaiting log completion and retaining actual write failures. */
  const line = async (value: string) => { await log.write(mask(value) + '\n'); console.log(mask(value)); };
  /** 先保存当前场景阶段，再执行异步断言，成功后记录返回证据并落盘；失败保存脱敏错误与场景信息后重抛。
   * Persist the active case/phase, then run asynchronous assertions and retain returned evidence on success with persistence; retain redacted failure/case information before rethrowing. */
  const check = async (name: typeof caseNames[number], action: /** 执行一个证据用例的异步动作并返回观测，异常由用例包装器记录后传播；动作不自行宣称整轮通过。
 * Execute one evidence case asynchronously and return observations; the case wrapper records/propagates failures and the action does not claim the whole run passed. */ () => Promise<unknown>) => {
    proof.activeCase = { name, startedAt: new Date().toISOString() }; await persist();
    try { const evidence = await action(); proof.cases.push({ ...proof.activeCase, finishedAt: new Date().toISOString(), evidence });
      delete proof.activeCase; await persist(); await line('PASS ' + setup.distro + ' ' + name);
    } catch (error) {
      proof.failedCase = { ...proof.activeCase, error: mask(error),
        code: typeof (error as any)?.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test((error as any).code) ? (error as any).code : null,
        status: typeof (error as any)?.status === 'number' ? (error as any).status : null };
      await persist(); throw error;
    }
  };
  process.env.SAKURA_DATA_DIR = setup.root; process.env.SAKURA_IMAGE_DIR = join(setup.workspace, '.data/images');
  process.env.SAKURA_IMAGE_PATH = join(setup.workspace, '.data/images', { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[setup.distro]);
  process.env.TEMP = process.env.TMP = setup.parent;
  const originalSource = process.env.SAKURA_GPG_EXTRA_SOCKET; process.env.SAKURA_GPG_EXTRA_SOCKET = setup.pins.SOURCE.path;
  const { Machines } = await import('../server/machines.ts');
  const { bootSetup } = await import('../server/seed.ts');
  const { diskOptions } = await import('../shared/hardware.ts');
  const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
  const { Secrets } = await import('../server/secrets.ts');
  const { Jobs } = await import('../server/jobs.ts');
  const { ProjectTerminals } = await import('../server/project-terminals.ts');
  const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { ProjectIdentities } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { runGpgAgentForward, guestGpgForwardingReady } = await import('../server/gpg-agent-forward.ts');
  const { OwnedGpgForward: Bridge, captureHostGpgSource, closeGpgHostLease } = await import('../server/gpg-agent-host.ts');
  const { GpgAgentScopes, gpgAgentRecordSchema, gpgAgentContextSchema, gpgAgentSocketPath } = await import('../server/gpg-agent-scope.ts');
  await mkdir(hostScope);
  const runtime = testOnlyEngine(setup, proof, diskOptions(setup.record));
  const machines = new Machines(runtime); await machines.init(); assert.equal(machines.live.size, 0);
  const bootLogFile = join(setup.parent, 'gpg-agent-project-identity-boot-' + invocation + '.log');
  const bootLogFd = openSync(bootLogFile, 'wx'); let bootLogBytes = 0;
  proof.bootLog = { file: bootLogFile, actualClosed: false, truncated: false };
  /** 最多保存四 MiB 原始启动日志，超出记录 truncated，避免来宾输出耗尽本地存储。
   * Retain at most four MiB raw boot logs and mark truncation to prevent guest output exhausting local storage. */
  const captureBootLog = (chunk: Buffer | string) => {
    const bytes = Buffer.from(chunk); const available = Math.max(0, 4 * 1024 * 1024 - bootLogBytes);
    if (bytes.length > available) proof.bootLog.truncated = true;
    if (available) { writeSync(bootLogFd, bytes.subarray(0, available)); bootLogBytes += Math.min(available, bytes.length); }
  };
  machines.on('log:' + setup.vmId, captureBootLog);
  const spaces = new Workspaces(machines, { secrets: new Secrets(machines, undefined, setup.secretDirectory) });
  await spaces.jobs.close(); spaces.jobs = new Jobs('owned-gpg', join(hostScope, 'jobs'));
  const terminals = new ProjectTerminals(machines, spaces), accounts = new ProjectRunScopes(machines);
  const core = new ProjectIdentities(machines), resources = new GpgAgentScopes(machines);
  const migrations = new ProjectDirectoryMigrations(machines, spaces);
  const ids = [fixtures[setup.distro].alpha, fixtures[setup.distro].beta];
  const identities: Record<string, ProjectIdentity> = Object.fromEntries(['alpha', 'beta'].map(kind => {
    const pair = setup.farm.projectPair[kind]; return [pair.id, pair.identity];
  }));
  const stage = identities[ids[0]].directory + '/gpg-agent-' + invocation;
  const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines);
  /** 要求保护正文不在 root argv，保存命令及分离输入的摘要/长度，明确后续结果是 Machines UTF-8 返回值而非 wire 原字节。
   * Require body absence from root argv and retain command/separate-input hashes-lengths, explicitly identifying later output as Machines UTF-8 values rather than raw wire bytes. */
  const inspectCommand = (command: string, input?: Buffer) => {
    assert.ok(!command.includes(canary), 'Project body appeared in a root command');
    const receipt: any = { sha256: hash(command), bodyAbsent: true, inputBytes: input?.length,
      ...(input ? { inputSha256: hash(input), protectedBody: input.includes(Buffer.from(canary)) } : {}),
      resultSource: 'Machines returned UTF-8 text; not raw SSH wire bytes', actualReturned: false };
    proof.rootCommands.push(receipt); return receipt;
  };
  /** 观测真实 reply 的状态与两路 UTF-8 摘要，并按精确 GPG 命令绑定 owner/lease/正文；只记录固定拒绝/合法回包诊断，不替换原结果或失败。
   * Observe actual reply status/both UTF-8 stream hashes and bind exact GPG commands to owner-lease-body, recording fixed refusal/valid-envelope diagnostics without replacing results/failures. */
  const observeReply = async <T extends { code: number; stdout: string; stderr: string }>(reply: Promise<T>, receipt: any, command: string): Promise<T> => {
    try {
      const actual = await reply;
      Object.assign(receipt, { actualReturned: true, code: actual.code,
        stdoutUtf8Bytes: Buffer.byteLength(actual.stdout), stdoutUtf8Sha256: hash(actual.stdout),
        stderrUtf8Bytes: Buffer.byteLength(actual.stderr), stderrUtf8Sha256: hash(actual.stderr) });
      if (/^# SAKURA_GPG_AGENT_(PREPARE|CLEANUP|READ)\n/.test(command)) {
        const action = command.match(/^# SAKURA_GPG_AGENT_(PREPARE|CLEANUP|READ)\n/)![1].toLowerCase() as 'prepare' | 'cleanup' | 'read';
        const owner = [...owners.values()].find(value => resources.command(action, value.context) === command);
        if (owner) receipt.requestBinding = { runId: owner.context.owner.runId, bootId: owner.context.owner.bootId,
          leaseId: owner.context.resource.leaseId, bodySha256: owner.context.sha256 };
        let value: any; try { value = JSON.parse(actual.stdout); } catch { receipt.diagnostic = { jsonValid: false }; }
        if (value) {
          const diagnostic: any = { jsonValid: true, successEnvelope: value.version === 1 && value.ok === true };
          if (value.ok === false && value.detail === null && Object.keys(value).sort().join(',') === 'code,detail,ok' &&
              typeof value.code === 'string' && /^GPG_AGENT_[A-Z0-9_]{1,80}$/.test(value.code)) diagnostic.fixedRefusalCode = value.code;
          if (value.ok === true && value.result) {
            const context = gpgAgentContextSchema.safeParse(value.result.context);
            diagnostic.contextValid = context.success;
            diagnostic.originalContextMatches = owner ? context.success && hash(JSON.stringify(context.data)) === hash(JSON.stringify(owner.context)) : null;
            const parsed = value.result.record === null ? null : gpgAgentRecordSchema.safeParse(value.result.record);
            diagnostic.recordValid = parsed === null || parsed.success;
            if (parsed && !parsed.success) diagnostic.schemaIssues = parsed.error.issues.map(issue => ({ path: issue.path.map(String), code: issue.code, message: issue.message })).slice(0, 32);
            diagnostic.closedResult = value.result.phase === 'closed' && (!value.result.record || value.result.record.phase === 'closed');
          }
          receipt.diagnostic = diagnostic;
        }
      }
      return actual; // Preserve the original result object; do not consume/replay streams.
    } catch (error) { receipt.transportRejected = true; receipt.error = mask(error); throw error; }
  };
  const originalAlpineReady = `set -e\ntest -f /var/lib/cloud/.bootstrap-complete\n${bootSetup()}\n/bin/sync`;
  const readonlyAlpineReady = 'set -e\ntest -f /var/lib/cloud/.bootstrap-complete\ntest -d /workspace\n/bin/sync';
  const cloudReady = 'test -f /var/lib/cloud/instance/boot-finished && test -d /workspace && /bin/sync';
  machines.exec = (/** 只观测自有 GPG VM 的 root 命令；启动阶段拒绝未知检查与身份文件，只对已知 Alpine 检查作只读替换并记录摘要，云检查保持原文且仅延长超时。
 * Observe root commands only for the owned GPG VM; during startup reject unknown checks/identity files, substitute only known Alpine readiness read-only with digests, and preserve cloud commands while extending timeout. */ async (...call: Parameters<typeof nativeExec>) => {
    assert.equal(call[0], setup.vmId); const receipt = inspectCommand(call[1]);
    if (machines.state(setup.vmId) === 'starting') {
      await mustBeAbsent(join(setup.machineDirectory, 'identity.json'));
      // A 1.8 second handshake budget is too short for stock Ubuntu on TCG.
      // Keep the exact command and product readiness/boot deadline; record the
      // test transport change separately from a successful readiness reply.
      receipt.requestedTimeout = call[2];
      call[2] = Math.max(call[2] ?? 0, 10000);
      receipt.effectiveTimeout = call[2];
      if (setup.distro === 'alpine') {
        assert.equal(call[1], originalAlpineReady, 'Unknown Alpine startup command refused.');
        proof.startupHarness.startupSubstitutions.push({ originalSha256: hash(call[1]), executedSha256: hash(readonlyAlpineReady),
          knownCommand: 'alpine-existing-bootstrap-readiness', testOnly: true });
        receipt.executedSha256 = hash(readonlyAlpineReady);
        return observeReply(nativeExec(call[0], readonlyAlpineReady, call[2], call[3]), receipt, readonlyAlpineReady);
      }
      // This exact cloud string only tests existing paths and flushes writes.
      // No package, SSH, network, identity or other config bytes are changed.
      assert.equal(call[1], cloudReady, 'Unknown cloud startup command refused.');
      proof.startupHarness.startupSubstitutions.push({ originalSha256: hash(call[1]), executedSha256: hash(call[1]),
        knownCommand: 'cloud-existing-bootstrap-readiness', testOnly: true,
        originalCommandUnchanged: true, requestedTimeout: receipt.requestedTimeout, effectiveTimeout: call[2] });
    }
    return observeReply(nativeExec(...call), receipt, call[1]);
  }) as typeof machines.exec;
  machines.execInput = (/** 运行期限定 execInput 到自有 VM，记录正文摘要后沿用原输入执行，再审计原回包，禁止未知启动阶段输入操作。
 * Limit runtime execInput to the owned VM, record body digest, execute the original input and audit its reply; reject unknown startup input operations. */ async (...call: Parameters<typeof nativeInput>) => {
    assert.equal(call[0], setup.vmId); assert.equal(machines.state(setup.vmId), 'running', 'Unknown startup input operation refused.');
    const receipt = inspectCommand(call[1], call[2]); return observeReply(nativeInput(...call), receipt, call[1]);
  }) as typeof machines.execInput;
  let bootId = '', baseline: any, replacementPending = false, replaced = false;
  const backup = join(dirname(setup.pins.SOURCE.path), 'gpg-owned-original-' + invocation);
  const replacementFile = join(dirname(setup.pins.SOURCE.path), 'gpg-owned-replacement-' + invocation);
  inside(setup.ownedHostRoot, backup); inside(setup.ownedHostRoot, replacementFile);
  type NativeObservation = { pid: number; originalPid: number | null; eventNames: string[]; sourceRefusalCodes: string[];
    nonceSent: boolean; birthBeforeSourceConnect: boolean; birthBeforeNonce: boolean;
    actualClose: boolean; exitCode: number | null; signal: NodeJS.Signals | null };
  type ObservedRelay = { child: ChildProcess; metadata: Record<string, unknown>[];
    closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> };
  type Owner = { bridge: OwnedGpgForward; context: GpgAgentContext; label: string;
    nativeObservations: NativeObservation[]; nativeClosed: Promise<void>[] };
  const owners = new Map<string, Owner>(), ownPlainRuns = new Set<string>();
  const originalStart = Bridge.prototype.start;
  let currentLabel = 'complete';
  Bridge.prototype.start = /** 包装正式 GPG bridge 入场以绑定项目与冻结来源/辅助器哈希，登记真实 helper 观测；仅在指定窗口替换自有 SOURCE 以验证原生来源拒绝，调用原 start 保留行为。
 * Wrap formal GPG-bridge admission to bind project/frozen source/helper digests and register real helper observations; replace owned SOURCE only in the selected window to test native refusal, preserving behavior through original start. */ async function (...call: Parameters<typeof originalStart>) {
    const context = call[2]; assert.equal(context.identity.projectId, ids[0]);
    assert.equal(context.resource.hostSourceSha256, this.hostSourceSha256); assert.equal(context.resource.hostHelperSha256, this.hostHelperSha256);
    const owner: Owner = { bridge: this, context: structuredClone(context), label: currentLabel, nativeObservations: [], nativeClosed: [] };
    owners.set(context.owner.runId, owner);
    // Test-only observation of real child metadata. Original add runs first;
    // no stream is consumed and native admission/authorize/frame order is unchanged.
    const helpers = Reflect.get(this, 'helpers') as Set<ObservedRelay>;
    assert.ok(helpers instanceof Set); assert.equal(helpers.size, 0);
    const originalAdd = helpers.add;
    helpers.add = /** 保持 Set.add 结果并为每个真实 helper 建立出生/来源/nonce/退出观测；等待其原 closed Promise，将验证失败保留在 owner.nativeClosed 中供统一清理验收。
 * Preserve Set.add’s result and capture each real helper’s birth/source/nonce/exit evidence; await its original closed promise and retain validation failures in owner.nativeClosed for cleanup acceptance. */ function (helper: ObservedRelay) {
      const result = originalAdd.call(this, helper); assert.ok(helper.child.pid);
      const observed: NativeObservation = { pid: helper.child.pid, originalPid: null, eventNames: [], sourceRefusalCodes: [],
        nonceSent: false, birthBeforeSourceConnect: false, birthBeforeNonce: false, actualClose: false, exitCode: null, signal: null };
      owner.nativeObservations.push(observed);
      const settled = helper.closed.then(/** 真实 helper 退出后读取有界结构化事件，核实 IDENTITY PID、来源拒绝码、出生先于连接/nonce及实际退出码；事件声明与真正关闭分别记录。
 * After actual helper exit read bounded structured events, verify IDENTITY PID, source-refusal codes, birth preceding connect/nonce and actual exit code, recording event claims separately from real closure. */ actual => {
        const events = helper.metadata; assert.ok(Array.isArray(events) && events.length <= 64);
        observed.eventNames = events.map(event => { assert.equal(typeof event.event, 'string'); return event.event as string; });
        const identity = events.find(event => event.event === 'IDENTITY')?.helper as { pid?: number } | undefined;
        assert.ok(identity); assert.equal(identity.pid, observed.pid); observed.originalPid = identity.pid!;
        observed.sourceRefusalCodes = events.filter(event => event.event === 'ERROR').map(event => {
          assert.equal(typeof event.code, 'string'); assert.match(event.code as string, /^[A-Z0-9_]{1,64}$/); return event.code as string;
        });
        observed.nonceSent = observed.eventNames.includes('NONCE_SENT');
        const birth = events.find(event => event.event === 'BIRTH_VERIFIED');
        observed.birthBeforeSourceConnect = birth?.beforeSourceConnect === true; observed.birthBeforeNonce = birth?.beforeNonce === true;
        observed.actualClose = true; observed.exitCode = actual.code; observed.signal = actual.signal;
      });
      void settled.catch(() => {}); owner.nativeClosed.push(settled);
      return result;
    };
    if (replacementPending) {
      replacementPending = false; await ordinaryFile(setup.pins.SOURCE.path, 4096);
      await rename(setup.pins.SOURCE.path, backup); replaced = true;
      await writeFile(setup.pins.SOURCE.path, '1\nowned-replacement-no-authentication\n', { flag: 'wx' });
    }
    return originalStart.apply(this, call);
  };
  const controllers = new Set<AbortController>(), pending = new Set<Promise<unknown>>();
  /** 以最多 128 KiB JSON stdin 调用当前 boot 的隔离观测器，六十秒期限，要求零退出并返回解析报告。
   * Call the isolated current-boot observer with at most 128-KiB JSON stdin/sixty-second deadline, require zero exit and return parsed reports. */
  const observe = async (request: object) => {
    const input = Buffer.from(JSON.stringify({ bootId, ...request })); assert.ok(input.length <= 128 * 1024);
    const result = await machines.execInput(setup.vmId, fixed + python(observer), input, 60000);
    assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout);
  };
  /** 读取指定标签的实际正文开始标记，首次保存后要求后续元数据与摘要不变，返回观测。
   * Read the label’s actual body-start marker, retaining its first metadata/hash and requiring later observations unchanged. */
  const report = async (label: string, ready = false) => {
    const observed = await observe({ operation: 'report', identity: identities[ids[0]], stage, invocation, label, ready });
    if (observed.report) {
      proof.bodyMarkers ||= {};
      const marker = { bodyBegan: observed.report.bodyBegan, metadata: observed.bodyBeganMetadata, sha256: observed.bodyBeganSha256 };
      const old = proof.bodyMarkers[observed.report.runId]; if (old) assert.deepEqual(marker, old);
      else proof.bodyMarkers[observed.report.runId] = marker;
    }
    return observed;
  };
  /** 读取本夹具指定项目的落盘身份日志并解析 JSON，供精确运行票据和关闭阶段核对；缺失或损坏直接失败。
   * Read/parse the fixture project’s persisted identity journal for exact-run receipts/closure-phase comparison; missing/corrupt records fail directly. */
  const journal = async (id: string) => JSON.parse(await readFile(join(setup.machineDirectory, 'project-identities', id + '.json'), 'utf8'));
  /** 构造 stock GPG 夹具的项目正文，包含明确 canary 注释和字面 stage/标签/模式参数，供保护传输检查。
   * Build the stock-GPG fixture project body with explicit canary comment/literal stage-label-mode arguments for protected-transport checks. */
  const command = (label: string, mode: string) => '# ' + canary + '\n/usr/bin/python3 -I -S ' +
    quote(stage + '/fixture.py') + ' ' + quote(stage) + ' ' + quote(label) + ' ' + quote(mode);
  /** 登记取消控制器与待完成任务，在精确项目调用真实 GPG 转发；finally 从追踪集移除，返回原 Promise 供签名/取消核验。
   * Register cancellation/pending work and call real GPG forwarding in the exact project, removing tracking in finally and returning the original promise for signing/cancellation checks. */
  const run = (label: string, mode: string, controller = new AbortController()) => {
    currentLabel = label; controllers.add(controller);
    const result = spaces.projects.inScope(setup.vmId, ids[0], () => runGpgAgentForward(machines, setup.vmId,
      { command: command(label, mode), confirmed: true, timeoutSeconds: 180 }, controller.signal, spaces, terminals));
    pending.add(result); void result.finally(() => { controllers.delete(controller); pending.delete(result); }).catch(() => {});
    return result;
  };
  /** 对实际 UID/GID、Home/cwd/NNP、私有 GPG Home、boot/run/cgroup 与正文开始标记一致性断言，签名时另核对解密摘要和 VALIDSIG。
   * Assert actual UID-GID/home-cwd-NNP/private GPG home/boot-run-cgroup/body-start consistency, additionally verifying decrypted hash/VALIDSIG for signed cases. */
  const validateReport = (value: any) => {
    const identity = identities[ids[0]]; assert.equal(value.uid, identity.uid); assert.equal(value.gid, identity.gid);
    assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home); assert.equal(value.cwd, identity.directory);
    for (const [key, content] of Object.entries(value.caps)) assert.equal(content, key === 'NoNewPrivs' ? '1' : '0000000000000000');
    assert.equal(value.homeWrite.uid, identity.uid); assert.equal(value.gpgHomeObject.uid, identity.uid); assert.equal(value.gpgHomeObject.mode, 0o700);
    assert.equal(value.bootId, bootId); assert.match(value.runId, uuidPattern); assert.equal(value.process.cgroup, '0::/sakura-task-' + value.runId);
    assert.equal(value.bodyBegan.invocation, invocation); assert.equal(value.bodyBegan.runId, value.runId);
    assert.equal(value.bodyBegan.bootId, bootId); assert.equal(value.bodyBegan.uid, identity.uid); assert.equal(value.bodyBegan.gid, identity.gid);
    if (value.signature) {
      assert.equal(value.decryptedSha256, setup.pins.PAYLOAD.sha256); assert.match(value.signature.signatureSha256, shaPattern);
      assert.ok(value.signature.validsig.startsWith('[GNUPG:] VALIDSIG ')); assert.ok(value.fingerprints.length);
    }
  };
  /** 六十秒内等真实 GPG 报告，将进程全部凭据、网络/cgroup inode 与精确身份/resource ready 票据绑定后返回。
   * Await a real GPG report within sixty seconds and bind all process credentials/network-cgroup inodes to exact identity/resource-ready receipts before returning. */
  const waitReady = async (label: string) => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const observed = await report(label, true);
      if (observed.report) {
        validateReport(observed.report); const owner = owners.get(observed.report.runId); assert.ok(owner);
        assert.equal(await accounts.active(setup.vmId, ids[0], owner.context.owner.runId), true);
        const ticket = (await journal(ids[0])).runs.find((entry: any) => entry.runId === owner.context.owner.runId).run as ProjectIdentityRun;
        assert.equal(ticket.networkInode, observed.report.networkInode); assert.equal(ticket.networkDevice, observed.report.networkDevice);
        assert.equal(ticket.namespace, 'sk-' + ids[0]);
        assert.equal(observed.cgroupObject.device, ticket.cgroupDevice); assert.equal(observed.cgroupObject.inode, ticket.cgroupInode);
        for (const process of observed.processes) {
          assert.equal(process.alive, true); assert.equal(process.uid, identities[ids[0]].uid); assert.equal(process.cgroup, '0::/' + ticket.cgroupName);
          assert.deepEqual(process.uids, Array(4).fill(String(identities[ids[0]].uid)));
          assert.deepEqual(process.gids, Array(4).fill(String(identities[ids[0]].gid))); assert.deepEqual(process.groups, []);
          for (const [key, content] of Object.entries(process.caps)) assert.equal(content, key === 'NoNewPrivs' ? '1' : '0000000000000000');
        }
        const resource = await resources.readonly(setup.vmId, owner.context); assert.equal(resource.phase, 'ready');
        assert.equal(resource.record!.scope!.device, ticket.cgroupDevice); assert.equal(resource.record!.scope!.inode, ticket.cgroupInode);
        return { ...observed, ticket, resource };
      }
      assert.ok(Date.now() < deadline, 'Owned stock GPG command did not become ready: ' + label); await delay(100);
    }
  };
  /** 要求主机/原生资源票据 closed、guest 路径与原进程消失、bridge 无流/helper；逐个比较实际 helper exit/socket close 并核验 host lease 关闭记录。
   * Require host/native resources closed/guest paths-original processes gone/zero bridge streams-helpers, compare actual helper exit-socket closure and verify host-lease close records. */
  const stopped = async (owner: Owner, processes: any[] = []) => {
    const runId = owner.context.owner.runId, entry = (await journal(ids[0])).runs.find((item: any) => item.runId === runId);
    assert.ok(entry); assert.equal(entry.phase, 'closed');
    assert.ok(proof.rootCommands.some((call: any) => call.protectedBody && call.inputSha256 === entry.sha256));
    assert.equal(await accounts.readonlyActive(setup.vmId, ids[0], runId), false);
    const resource = await resources.readonly(setup.vmId, owner.context); assert.equal(resource.phase, 'closed');
    const guest = await observe({ operation: 'stopped', context: owner.context, processes });
    assert.ok(guest.paths.every((path: any) => path.exists === false)); assert.ok(guest.processes.every((process: any) => process.alive === false));
    assert.equal(owner.bridge.streamCount, 0); assert.equal(owner.bridge.helperCount, 0);
    await Promise.all(owner.nativeClosed);
    const receipts = owner.bridge.helperReceipts;
    for (const receipt of receipts) {
      assert.equal(receipt.actualClose, true); assert.notEqual(receipt.exitCode, null); assert.equal(receipt.signal, null);
      if (owner.label !== 'replacement') { assert.equal(receipt.exitCode, 0); assert.equal(receipt.physicalSocketClose, true); }
      const observed = owner.nativeObservations.find(value => value.originalPid === receipt.pid); assert.ok(observed);
      assert.equal(observed.actualClose, true); assert.equal(observed.exitCode, receipt.exitCode); assert.equal(observed.signal, receipt.signal);
    }
    await closeGpgHostLease(owner.context);
    const hostLedger = join(setup.root, 'gpg-agent-host-owner-' + owner.context.resource.leaseId + '-' + runId);
    const hostClosedFile = join(hostLedger, 'host-close.json'); await ordinaryFile(hostClosedFile);
    const closedBytes = await readFile(hostClosedFile), hostClosed = JSON.parse(closedBytes.toString('utf8'));
    assert.equal(hostClosed.phase, 'closed');
    if (hostClosed.listenerClosure === 'not-started') {
      assert.equal(hostClosed.originalListenerCreated, false); assert.equal(hostClosed.actualUnforward, false);
      assert.equal(typeof hostClosed.actualSshClose, 'boolean');
    } else if (hostClosed.listenerClosure === 'unforward-acknowledged') {
      assert.equal(hostClosed.originalListenerCreated, true); assert.equal(hostClosed.actualUnforward, true); assert.equal(hostClosed.actualSshClose, true);
    } else {
      assert.equal(hostClosed.listenerClosure, 'ssh-transport-closed');
      assert.ok(hostClosed.originalListenerCreated === true || hostClosed.originalListenerCreated === null);
      assert.equal(hostClosed.actualUnforward, false); assert.equal(hostClosed.actualSshClose, true);
    }
    assert.deepEqual(hostClosed.context, owner.context);
    return { runId, context: owner.context, entry, resource, guest, hostClosedFile, hostClosedSha256: hash(closedBytes),
      hostClosed, helperReceipts: receipts, nativeObservations: owner.nativeObservations, independentOriginalProcessDeadCheck: true,
      physicalStreams: owner.bridge.streamCount, physicalHelpers: owner.bridge.helperCount };
  };
  let firstReady: any, secondReady: any, first: Promise<any> | undefined, second: Promise<any> | undefined;
  const firstController = new AbortController();
  /** 比较整个历史基线，只允许同字节原子绑定发布改变 ledger inode；记录已验证的新 inode，不放宽内容/权限/身份字段。
   * Compare the complete historical baseline, allowing only same-byte atomic binding publication to change ledger inode; record verified new inodes without relaxing content/permissions/identity. */
  const compareBaseline = (actual: any) => {
    const { ledgerObjects: previousLedger, ...previous } = baseline;
    const { ledgerObjects: currentLedger, ...current } = actual;
    assert.deepEqual(current, previous); // Accounts, HOME/project directory inodes and ready assets stay exact.
    assert.deepEqual(Object.keys(currentLedger).sort(), Object.keys(previousLedger).sort());
    for (const path of Object.keys(previousLedger)) {
      const { inode: oldInode, ...before } = previousLedger[path];
      const { inode: newInode, ...after } = currentLedger[path]; assert.deepEqual(after, before);
      if (newInode !== oldInode && !proof.atomicLedgerTransitions.some((value: any) => value.path === path && value.newInode === newInode))
        proof.atomicLedgerTransitions.push({ path, oldInode, newInode, sha256: current.files[path].sha256,
          device: after.device, identity: current.files[path].identity, reason: 'same-byte atomic project binding publication' });
    }
  };
  const readyPaths = Object.keys(setup.farm.originalGuestBaseline.readyTrees);
  try {
    assert.equal(machines.state(setup.vmId), 'stopped');
    proof.startRequestedAt = Date.now(); await machines.start(setup.vmId);
    const deadline = Date.now() + 300000;
    while (machines.state(setup.vmId) !== 'running') {
      if (machines.state(setup.vmId) !== 'starting') {
        proof.startupState = machines.state(setup.vmId); proof.startupError = machines.live.get(setup.vmId)?.error;
        throw new Error('Original VM readiness failed; inspect the retained actual boot log.');
      }
      assert.ok(Date.now() < deadline); await delay(200);
    }
    proof.reachedRunning = true;
    bootId = (await machines.exec(setup.vmId, fixed + '/bin/cat /proc/sys/kernel/random/boot_id', 10000)).stdout.trim();
    assert.match(bootId, uuidPattern);
    await check(caseNames[0], /** 只读确认原夹具现成 GPG/Python、SSH 转发许可和被冻结 host SOURCE/helper 身份；依赖不足直接拒绝，不修改源配置或启动管理 Agent。
 * Read-only verify the original fixture’s existing GPG/Python, SSH-forwarding permission and frozen host SOURCE/helper identities; refuse missing dependencies without altering source configuration or managing the Agent. */ async () => {
      const guest = await machines.exec(setup.vmId, fixed + '/bin/sh -c ' +
        quote('test -x /usr/bin/gpg && test -x /usr/bin/python3 && command -v gpgconf >/dev/null'), 10000);
      assert.equal(guest.code, 0,
        'Original fixture lacks stock GPG/Python. Reuse requires unchanged dependencies; use a separately validated new COW fixture.');
      assert.equal(await guestGpgForwardingReady(machines, setup.vmId), true,
        'Original SSH configuration forbids native GPG forwarding; refusing to alter it.');
      assert.ok(['', '0', '1'].includes(process.env.SAKURA_AGENT_PRIVATE || ''));
      const snapshot = await captureHostGpgSource(setup.pins.SOURCE.path);
      assert.equal(snapshot.pins.anchorPath, setup.ownedHostRoot); assert.deepEqual(snapshot.pins.anchor, setup.ownedHostRootPin);
      assert.equal(snapshot.hostHelperSha256, setup.freeze.assetSha256['.sakura-server/assets/gpg-agent-host/relay.exe']);
      assert.equal(snapshot.pins.sourceFileSha256, setup.pins.SOURCE.sha256); proof.hostSourceSnapshot = snapshot;
      return { guestStockGpg: true, hostSourceSha256: snapshot.hostSourceSha256, restrictedExtraNativeProbe: true,
        effectiveNetworkIsolation: 'private', requestedPrivateFlag: process.env.SAKURA_AGENT_PRIVATE || '', agentWasStartedOrManaged: false };
    });
    baseline = await observe({ operation: 'baseline', identities: Object.values(identities), readyPaths });
    proof.originalGuestBaseline = baseline;
    await check(caseNames[1], async () => {
      const result = [];
      for (const id of ids) {
        assert.deepEqual(await core.inspect(setup.vmId, id), identities[id]);
        const value = await spaces.projects.inScope(setup.vmId, id, () => spaces.config(setup.vmId));
        assert.equal(projectVersion(value), setup.farm.projectPair[id === ids[0] ? 'alpha' : 'beta'].configVersion);
        const migration = await spaces.projects.inScope(setup.vmId, id, () => migrations.view(setup.vmId));
        assert.equal(migration.lastFailure, null); if (migration.plan) assert.equal(migration.plan.state, 'applied');
        result.push({ id, identity: identities[id], configVersion: projectVersion(value), migration });
      }
      return result;
    });
    await check(caseNames[2], async () => {
      const manifest = { invocation, identity: identities[ids[0]], files: { 'public.asc': setup.pins.PUBLIC.sha256,
        'payload.bin': setup.pins.PAYLOAD.sha256, 'ciphertext.gpg': setup.pins.CIPHERTEXT.sha256 } };
      const files = { 'fixture.py': Buffer.from(application).toString('base64'),
        'manifest.json': Buffer.from(JSON.stringify(manifest)).toString('base64'),
        'public.asc': setup.pins.PUBLIC.bytes!.toString('base64'), 'payload.bin': setup.pins.PAYLOAD.bytes!.toString('base64'),
        'ciphertext.gpg': setup.pins.CIPHERTEXT.bytes!.toString('base64') };
      const staged = await observe({ operation: 'stage', identity: identities[ids[0]], stage, invocation, files });
      assert.equal(staged.metadata.uid, identities[ids[0]].uid); assert.equal(staged.metadata.mode, 0o700);
      return { ...staged, applicationSha256: hash(application), publicOnlyInputs: true };
    });
    await check(caseNames[3], async () => {
      const result = await run('complete', 'complete'); assert.equal(result.code, 0, result.stderr); assert.equal(result.ready, true);
      const value = (await report('complete')).report; validateReport(value);
      assert.equal(result.projectId, ids[0]); assert.equal(result.networkIsolation, 'private');
      const owner = owners.get(value.runId); assert.ok(owner);
      return { result, report: value, closed: await stopped(owner, [value.process]) };
    });
    await check(caseNames[4], async () => {
      const count = owners.size, nativeDirectories = (await readdir(setup.root)).sort();
      const runJournalSha256 = hash(await readFile(join(setup.machineDirectory, 'project-identities', ids[0] + '.json')));
      await assert.rejects(spaces.projects.inScope(setup.vmId, ids[0], () => runGpgAgentForward(machines, setup.vmId,
        { command: 'true', confirmed: false }, undefined, spaces, terminals)));
      assert.equal(owners.size, count); assert.deepEqual((await readdir(setup.root)).sort(), nativeDirectories);
      assert.equal(hash(await readFile(join(setup.machineDirectory, 'project-identities', ids[0] + '.json'))), runJournalSha256);
      return { refused: true, newAdmissions: 0, nativeBirthDirectoryAndJournalUnchanged: true };
    });
    await check(caseNames[5], async () => {
      const result = await run('nonzero', 'nonzero'); assert.equal(result.code, 7); assert.equal(result.ready, false);
      const value = (await report('nonzero')).report; validateReport(value);
      const owner = owners.get(value.runId); assert.ok(owner);
      return { exitCode: result.code, report: value, closed: await stopped(owner, [value.process]) };
    });
    await check(caseNames[6], async () => {
      first = run('first', 'hold', firstController); void first.catch(() => {}); firstReady = await waitReady('first');
      second = run('second', 'hold'); void second.catch(() => {}); secondReady = await waitReady('second');
      assert.notEqual(firstReady.report.runId, secondReady.report.runId);
      assert.notEqual(firstReady.report.gpgHome, secondReady.report.gpgHome); return { first: firstReady, second: secondReady };
    });
    await check(caseNames[7], /** 以邻项目真实 UID 访问目标 GPG Home/socket 必须 PermissionError，同时核验空 groups/零能力、独立网络及正式 task 票据关闭。
 * Require PermissionError when a real neighbor UID accesses target GPG home/sockets, while verifying empty groups/zero capabilities, separate network and closed formal task receipts. */ async () => {
      const oldIds = new Set((await journal(ids[1])).runs.map((value: any) => value.runId));
      const target = owners.get(firstReady.report.runId); assert.ok(target);
      const refusedPaths = [firstReady.report.gpgHome + '/S.gpg-agent', gpgAgentSocketPath(target.context.resource.leaseId)];
      const source = [
        'import json,os,socket', `p=${JSON.stringify(firstReady.report.gpgHome)}`,
        'assert not os.access(p,os.R_OK|os.W_OK|os.X_OK)', `paths=${JSON.stringify(refusedPaths)}`,
        'for path in paths:', ' s=socket.socket(socket.AF_UNIX)', ' try:',
        "  s.connect(path);raise RuntimeError('other project connected')", ' except PermissionError:pass', ' finally:s.close()',
        "status=dict(line.rstrip().split(':',1) for line in open('/proc/self/status') if ':' in line)",
        "caps={key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')}",
        "assert all(int(caps[key],16)==0 for key in caps if key!='NoNewPrivs') and caps['NoNewPrivs']=='1'",
        "network=os.stat('/proc/self/ns/net')",
        "print(json.dumps({'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'egid':os.getegid(),'groups':os.getgroups(),'caps':caps,'refusedPaths':paths,'scope':open('/proc/self/cgroup').read().strip(),'networkDevice':str(network.st_dev),'networkInode':str(network.st_ino)}))",
      ].join('\n') + '\n';
      const prepared = await terminals.prepare(setup.vmId, ids[1], null, false, undefined, undefined, { mode: 'task' });
      let result, issued: any[] = [];
      try {
        assert.ok(prepared.captured && prepared.signal);
        const value = await spaces.resolveProject(setup.vmId, prepared.captured.project);
        result = await projectIdentityTask(machines, setup.vmId, value,
          { command: python(source), environment: value.environment }, prepared.signal,
          undefined, 30000, undefined, undefined, { expectedLive: prepared.captured.live });
      } finally {
        prepared.release();
        issued = (await journal(ids[1])).runs.filter((entry: any) => !oldIds.has(entry.runId));
        assert.equal(issued.length, 1);
        assert.deepEqual(issued[0].identity, identities[ids[1]]);
        assert.equal(issued[0].owner.kind, 'task'); assert.equal(issued[0].owner.bootId, bootId);
        ownPlainRuns.add(issued[0].runId);
      }
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
      assert.equal(issued[0].phase, 'closed'); assert.equal(issued[0].run?.phase, 'closed');
      const actual = JSON.parse(result.stdout);
      assert.equal(actual.uid, identities[ids[1]].uid); assert.equal(actual.euid, actual.uid);
      assert.equal(actual.gid, identities[ids[1]].gid); assert.equal(actual.egid, actual.gid); assert.deepEqual(actual.groups, []);
      assert.deepEqual(actual.refusedPaths, refusedPaths); assert.equal(actual.scope, '0::/sakura-task-' + issued[0].runId);
      assert.equal(actual.networkDevice, issued[0].run.networkDevice); assert.equal(actual.networkInode, issued[0].run.networkInode);
      assert.notEqual(actual.networkInode, firstReady.report.networkInode);
      return { otherProjectId: ids[1], runId: issued[0].runId, code: result.code, actual };
    });
    await check(caseNames[8], async () => {
      firstController.abort(); await assert.rejects(first!);
      const owner = owners.get(firstReady.report.runId); assert.ok(owner);
      const closed = await stopped(owner, [firstReady.report.process, ...firstReady.report.descendants]);
      const neighbor = await report('second', true); assert.ok(neighbor.processes.every((process: any) => process.alive));
      assert.equal(await accounts.readonlyActive(setup.vmId, ids[0], secondReady.report.runId), true);
      return { closed, neighborRunId: secondReady.report.runId, neighborStillActive: true };
    });
    await check(caseNames[9], async () => {
      await observe({ operation: 'gate', identity: identities[ids[0]], stage, invocation, label: 'second' });
      const result = await second!; assert.equal(result.code, 0, result.stderr);
      const value = (await report('second')).report; validateReport(value);
      assert.ok(value.afterNeighborClose.validsig.startsWith('[GNUPG:] VALIDSIG '));
      const owner = owners.get(value.runId); assert.ok(owner);
      return { result, report: value, closed: await stopped(owner, [value.process, ...value.descendants]) };
    });
    await check(caseNames[10], async () => {
      const before = hash(await readFile(join(setup.machineDirectory, 'project-identities', ids[0] + '.json'))), reads = [];
      for (const owner of owners.values()) {
        assert.equal(await new ProjectRunScopes(machines).readonlyActive(setup.vmId, ids[0], owner.context.owner.runId), false);
        reads.push(await new GpgAgentScopes(machines).readonly(setup.vmId, owner.context));
      }
      assert.equal(hash(await readFile(join(setup.machineDirectory, 'project-identities', ids[0] + '.json'))), before);
      return { reads, hostJournalUnchanged: true, issuedAgain: false };
    });
    await check(caseNames[11], /** 在桥接入场窗口替换自有来源文件，要求真实 relay 在发 nonce 前以 SOURCE_W32_FORMAT 拒绝并实际退出；关闭精确原任务后恢复来源，重验物理锚与哈希。
 * Replace the owned source during bridge admission and require real relays to reject with SOURCE_W32_FORMAT before nonce and actually exit; close the exact original task, restore source and reverify physical anchor/digest. */ async () => {
      replacementPending = true;
      let result: Awaited<ReturnType<typeof run>> | undefined, refusal: string | undefined;
      try { result = await run('replacement', 'complete'); } catch (error) { refusal = mask(error); }
      assert.ok(refusal || result && result.code !== 0, 'The replaced source must not produce a successful Agent operation.');
      assert.equal(replaced, true);
      const owner = [...owners.values()].find(value => value.label === 'replacement'); assert.ok(owner);
      const body = await observe({ operation: 'replacement', identity: identities[ids[0]], stage, invocation, label: 'replacement', context: owner.context });
      await accounts.recoverStoppedTasks(setup.vmId, ids[0]);
      const closed = await stopped(owner, [{ pid: body.bodyBegan.pid, ticks: body.bodyBegan.ticks }]);
      assert.ok(closed.nativeObservations.length > 0, 'A real native relay must observe the replacement.');
      assert.equal(closed.nativeObservations.length, closed.helperReceipts.length);
      for (const observed of closed.nativeObservations) {
        assert.equal(observed.actualClose, true); assert.equal(observed.exitCode, 1); assert.equal(observed.signal, null);
        assert.equal(observed.birthBeforeSourceConnect, true); assert.equal(observed.birthBeforeNonce, true);
        assert.deepEqual(observed.sourceRefusalCodes, ['SOURCE_W32_FORMAT']); assert.equal(observed.nonceSent, false);
        assert.equal(observed.eventNames.includes('SOURCE_ATTESTED_BEFORE_NONCE'), false);
        assert.equal(observed.eventNames.includes('READY'), false);
      }
      await rename(setup.pins.SOURCE.path, replacementFile); await rename(backup, setup.pins.SOURCE.path); replaced = false;
      const snapshot = await captureHostGpgSource(setup.pins.SOURCE.path);
      assert.equal(snapshot.pins.anchorPath, setup.ownedHostRoot); assert.deepEqual(snapshot.pins.anchor, setup.ownedHostRootPin);
      assert.equal(snapshot.pins.sourceFileSha256, setup.pins.SOURCE.sha256);
      return { bodyStarted: true, body, result, refusal, agentOperationSucceeded: false,
        signatureDecryptionAndSuccessReportAbsent: true, relayNonceSentBeforeActualClose: false,
        sourceNonceReadByNode: false, originalRestored: true, closed };
    });
    compareBaseline(await observe({ operation: 'baseline', identities: Object.values(identities), readyPaths }));
    proof.originalAccountsBindingsAndReadyAssetsUnchanged = true;
  } catch (error) {
    proof.error = mask(error); process.exitCode = 1;
    if (machines.state(setup.vmId) === 'running') for (const owner of [...owners.values()].slice(0, caseNames.length)) {
      try {
        const observed = await observe({ operation: 'failure', identity: owner.context.identity, stage, invocation,
          label: owner.label, context: owner.context });
        proof.failureObservations.push({ runId: owner.context.owner.runId, leaseId: owner.context.resource.leaseId,
          observedBeforeVmStop: true, observation: observed });
      } catch (failure) { proof.failureObservations.push({ runId: owner.context.owner.runId, error: mask(failure), observedBeforeVmStop: true }); }
    }
    await persist();
  }
  finally {
    /** 将清理步骤与脱敏错误保存在报告中，供最终失败判断；记录本身不吞掉其他步骤的清理机会。
     * Retain cleanup step/redacted failure in the report for final acceptance while allowing other teardown steps to run. */
    const cleanupError = (step: string, error: unknown) => proof.cleanupErrors.push({ step, error: mask(error) });
    for (const controller of controllers) controller.abort(); await Promise.allSettled([...pending]);
    if (replaced) {
      try { await rename(setup.pins.SOURCE.path, replacementFile); await rename(backup, setup.pins.SOURCE.path); replaced = false; }
      catch (error) { cleanupError('Restore exact own native source', error); }
    }
    if (machines.state(setup.vmId) === 'running') {
      for (const id of ids) try { await accounts.recoverStoppedTasks(setup.vmId, id); }
      catch (error) { cleanupError('Exact owned task recovery ' + id, error); }
      for (const owner of owners.values()) try {
        proof.finalOwnedScopes ||= []; proof.finalOwnedScopes.push(await stopped(owner));
      } catch (error) { cleanupError('Confirm exact GPG resource ' + owner.context.owner.runId, error); }
      if (baseline) try {
        compareBaseline(await observe({ operation: 'baseline', identities: Object.values(identities), readyPaths }));
        proof.originalAccountsBindingsAndReadyAssetsUnchanged = true;
      } catch (error) { cleanupError('Original guest account/runtime preservation', error); }
    }
    Bridge.prototype.start = originalStart; machines.exec = nativeExec; machines.execInput = nativeInput;
    for (const [step, action] of [['Project terminals', () => terminals.close()], ['Workspace', () => spaces.close()],
      ['Exact fixture VM', () => machines.close()]] as const)
      try { await action(); } catch (error) { cleanupError(step, error); }
    machines.off('log:' + setup.vmId, captureBootLog); closeSync(bootLogFd);
    proof.bootLog.actualClosed = true; proof.bootLog.bytes = bootLogBytes;
    proof.bootLog.sha256 = hash(await readFile(bootLogFile));
    if (originalSource === undefined) delete process.env.SAKURA_GPG_EXTRA_SOCKET; else process.env.SAKURA_GPG_EXTRA_SOCKET = originalSource;
    proof.vmStopped = machines.state(setup.vmId) === 'stopped'; proof.liveEntries = machines.live.size;
    proof.ownedQemuSettled = proof.qemuExecutions.length === 1 && proof.qemuExecutions.every((entry: any) => entry.spawned && entry.actualExit &&
      entry.actualClose && entry.stdoutEnded && entry.stdoutClosed && entry.stderrEnded && entry.stderrClosed && entry.settled);
    try { proof.exactQemuMatches = setup.exactQemu(); } catch (error) { cleanupError('Independent exact QEMU inventory', error); }
    try {
      for (const [file, sha256] of setup.files) assert.equal((await fileDigest(file, Number.MAX_SAFE_INTEGER)).sha256, sha256, file);
      const guardBytes = await readFile(setup.bootGuardBefore.file), guardAfter = JSON.parse(guardBytes.toString('utf8'));
      assert.deepEqual(Object.keys(guardAfter), ['attempts']);
      assert.ok(Array.isArray(guardAfter.attempts) && guardAfter.attempts.every((at: unknown) => Number.isSafeInteger(at) && Number(at) >= 0));
      proof.normalBootGuardRuntime.after = { sha256: hash(guardBytes), state: guardAfter, manuallyReset: false };
      if (proof.reachedRunning) assert.deepEqual(guardAfter, { attempts: [] });
      else if (hash(guardBytes) !== setup.bootGuardBefore.sha256) {
        const ownAttempt = guardAfter.attempts.at(-1);
        assert.ok(ownAttempt >= proof.startRequestedAt && ownAttempt <= Date.now());
        assert.deepEqual(guardAfter.attempts, [...setup.bootGuardBefore.state.attempts.filter((at: number) => at > ownAttempt - 300000 && at <= ownAttempt), ownAttempt]);
      }
      proof.finalDisk = await fileDigest(setup.runtimeFiles.disk.path, Number.MAX_SAFE_INTEGER);
      for (const name of ['identity.json', '.disk-encryption.pending.json', '.disk.encrypting.qcow2', '.disk.before-encrypt.qcow2'])
        await mustBeAbsent(join(setup.machineDirectory, name));
      assert.equal(hash(await readFile(setup.freezeFile)), hash(setup.freezeBytes));
      const finalRecords = JSON.parse(await readFile(join(setup.root, 'machines.json'), 'utf8'));
      /** 仅剔除允许随观测变化的 lastUsedAt，保留其他字段进行前后不变性比较。
       * Remove only observational lastUsedAt and retain every other field for before/after immutability comparison. */
      const stable = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'lastUsedAt'));
      assert.equal(finalRecords.length, 1); assert.deepEqual(stable(finalRecords[0]), stable(setup.record));
      const ownIds = new Set([...owners.keys(), ...ownPlainRuns]);
      for (const [id, old] of setup.oldJournals) {
        const current = await journal(id), { runs: oldRuns, ...oldMetadata } = old, { runs: currentRuns, ...metadata } = current;
        assert.deepEqual(metadata, oldMetadata);
        for (const run of oldRuns) {
          const entry = currentRuns.find((value: any) => value.runId === run.runId) || JSON.parse(await readFile(
            join(setup.machineDirectory, 'project-identities', id, 'closed-runs', run.runId + '.json'), 'utf8'));
          assert.deepEqual(entry, run, 'An old run receipt changed');
        }
        const newRuns = currentRuns.filter((run: any) => !oldRuns.some((old: any) => old.runId === run.runId));
        assert.ok(newRuns.every((run: any) => ownIds.has(run.runId) && run.phase === 'closed'));
      }
      proof.oldProofsConfigsSecretsArchivesAndEveryOldRunUnchanged = true;
    } catch (error) { cleanupError('Old evidence and source/asset preservation', error); }
    if (!proof.vmStopped || proof.liveEntries || proof.exactQemuMatches !== 0 || !proof.ownedQemuSettled)
      cleanupError('Exact VM shutdown', 'Stopped/live/QEMU guard failed');
    proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === proof.expectedCases;
    proof.phase = proof.passed ? 'finished' : 'failed'; proof.finishedAt = new Date().toISOString();
    await persist(); await line('GPG project identity proof: ' + proofFile); await log.sync(); await log.close();
    process.exitCode = proof.passed ? 0 : 1;
  }
  if (!proof.passed) throw new Error('Owned native GPG smoke failed; new UUID evidence retained: ' + proofFile);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--describe') console.log(JSON.stringify({ version: 1, requiredSources, requiredAssets, caseNames,
  arguments: '<alpine|debian|ubuntu> <exact-farm-fixture> <gpg-agent-project-identity-freeze-UUID.json> [--validate-only|--reuse-existing]',
  defaultMode: '--validate-only', freezeFields: ['version=1', 'frozen=true', 'head', 'sourceSha256', 'assetSha256', 'ownedHostRoot', 'ownedHostRootPin', 'ownedHostMarker', 'testInputs'],
  ownedHostRoot: '.data direct child matching ^[a-f0-9]{32}$, exact realpath and private protected ACL; all test inputs must be inside.',
  ownedHostRootPin: 'Production capture anchor FileInfo: id, owner, aclSha256, attributes, links, directory=true, protectedAcl=true.',
  ownedHostMarker: 'Exact root/host-owned-marker.json path and SHA256; version=1, kind=sakura-gpg-host-test, UUID matching root, ownedHostRoot, createdByNodePid.',
  testOnlyStartupHarness: 'Single direct-spawn TCG Engine for exact original disk/seed; no createRuntime, WHPX probe or PosixLoom config. Ubuntu uses test-only multi-threaded TCG without icount. Requested/executed argument SHAs, original input SHAs and actual QEMU close are recorded. Only exact known Alpine readiness is replaced; known cloud readiness runs unchanged; unknown startup operations are refused.',
  privateFlag: { environment: 'SAKURA_AGENT_PRIVATE', accepted: ['', '0', '1'], reuseEffective: 'private (original Farm account contract)' },
  testInputs: inputNames.map(name => ({ name, pathEnvironment: 'SAKURA_GPG_TEST_' + name, sha256Environment: 'SAKURA_GPG_TEST_' + name + '_SHA256' })),
  preflight: 'Read-only files and exact process inventory; no native guard, VM startup, Agent management, or guest dependency installation.',
  sourceReplacementCase: 'The project body starts and writes its exact invocation/runId/bootId marker as the project UID with mode 0600. The first real Agent connection rejects the changed source; signature, decrypted output and successful report are absent. Complete native events at actual child close must contain the source refusal and no NONCE_SENT. This is not a before-body admission claim.',
  missingGuestDependency: 'Refuse reuse. A separately validated new COW fixture has its own execution scope.' }, null, 2));
else {
  const setup = await validate(args);
  if ((args[3] || '--validate-only') === '--validate-only') console.log(JSON.stringify({ validated: true, vmStarted: false, agentStarted: false,
    nativeGuardStarted: false, guestGpgStatus: 'Offline; checked only on explicit actual run without installing.', distro: setup.distro,
    fixture: setup.root, vmId: setup.vmId, freezeSha256: hash(setup.freezeBytes), previousFarmProofSha256: fixtures[setup.distro].sha256,
    ownedHostRoot: setup.ownedHostRoot, hostRootAclAndMarkerValidated: true, hostRoot128bitFileId: 'Deferred to native actual capture.',
    hostSourceAuthentication: 'Not probed offline; SOURCE bytes and SHA256 are checked only by the native helper on an actual run.',
    testOnlyStartupHarness: true, originalRuntimeInputs: setup.runtimeFiles,
    preservedFiles: setup.files.size, expectedCases: caseNames.length }, null, 2));
  else await runSmoke(setup);
}
