/**
 * 模块职责：在真实项目作用域核对服务边车、有限任务、启动依赖、UID 和网络，并验证全域停止与重启恢复。
 * Module: Check service sidecars, finite tasks, startup dependencies, UID and network in real project scopes, then verify whole-domain stop and reboot recovery.
 * 设计思路：先固定源码/二进制与自有夹具边界，再按完整 VM、boot、项目和运行身份记录生产回执及内核观察；不同层的完成/关闭证据分别核对，诊断输出不扩大实际验收范围。
 * Design: Pin sources/binaries and fixture ownership first, then record production receipts/kernel observations against complete VM/boot/project/run identity. Check completion/closure at each layer separately; diagnostics do not broaden actual acceptance.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { ProjectIdentity, ProjectIdentityRun } from '../server/project-identity.ts';
import type { ServiceMeshOptions } from '../server/service-mesh.ts';

const positional = process.argv.slice(2).filter(value => !value.startsWith('--'));
assert.ok(positional.length <= 1, 'Provide at most one smoke distro');
assert.ok(process.argv.slice(2).filter(value => value.startsWith('--')).every(value =>
  ['--describe', '--validate-only'].includes(value)), 'unsupported smoke option');
const distro = positional[0] || 'debian';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(Object.hasOwn(images, distro), 'unsupported smoke distro');
const envoyVersion = '1.39.1', envoySha256 = '002c6e1c69ed0fa0ea381887247cadadfaec9481375fa8d8d2b1731eeabf40b8';
const cache = resolve('.data', 'envoy-' + envoyVersion + '-linux-x86_64');
const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 18080 };
/**
 * 中文功能：将单个参数编码为 shell 安全的单引号形式，供固定客户机命令拼装。
 * English: Encode one argument as shell-safe single-quoted text for fixed guest-command assembly.
 * 输入 / Inputs: value: string。
 * 结果：返回分支计算值（`"'" + value.replaceAll("'", "'\\''") + "'"`）。
 * Result: Return the branch-computed value (`"'" + value.replaceAll("'", "'\\''") + "'"`).
 * 协作入口 / Collaborators: `value.replaceAll`.
 */
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
/**
 * 中文功能：计算输入字节的 SHA-256，供源码、二进制或证据内容核对。
 * English: Compute SHA-256 over input bytes for source, binary or evidence-content checks.
 * 输入 / Inputs: value: string | Buffer。
 * 结果：返回分支计算值（`createHash('sha256').update(value).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(value).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(value).digest`, `createHash('sha256').update`, `createHash`.
 */
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rootEnvironment = 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ';
// Only fixed smoke bootstrap/observation code is placed in root argv.
const uidProbe = String.raw`#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>

/* Fixed smoke fixture, loaded after native credential drop. Real Envoy remains
 * the pinned executable. Other dynamic executables immediately return. */
static void quoted(FILE *out, const char *value) {
  fputc('"', out);
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; ++p) {
    if (*p == '"' || *p == '\\') { fputc('\\', out); fputc(*p, out); }
    else if (*p < 32) fprintf(out, "\\u%04x", *p);
    else fputc(*p, out);
  }
  fputc('"', out);
}
static int read_text(const char *path, char *data, size_t size) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  ssize_t count = read(fd, data, size - 1); close(fd);
  if (count < 0 || (size_t)count == size - 1) return -1;
  data[count] = 0; return (int)count;
}
static int ticks(pid_t pid, char *output, size_t size) {
  char path[64], data[4096]; snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid);
  if (read_text(path, data, sizeof(data)) < 0) return -1;
  char *end = strrchr(data, ')'), *save = NULL;
  if (!end) return -1;
  char *token = strtok_r(end + 2, " ", &save);
  for (int i = 0; i < 19 && token; ++i) token = strtok_r(NULL, " ", &save);
  if (!token || strlen(token) >= size) return -1;
  strcpy(output, token); return 0;
}
__attribute__((constructor)) static void prove_envoy(void) {
  char executable[4096]; ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
  if (length < 0) return; executable[length] = 0;
  if (strcmp(executable, "/usr/local/bin/envoy")) return;
  const char *marker = getenv("SAKURA_MESH_UID_TEST"), *frame = getenv("SAKURA_MESH_FRAME_ENV");
  if (!marker || !frame) return;
  if (strlen(marker) > 80 || strchr(marker, '/') || !getuid() || !geteuid()) _exit(88);
  char command[65536]; int count = read_text("/proc/self/cmdline", command, sizeof(command));
  if (count < 0) _exit(88);
  const char *operation = "service";
  for (int at = 0; at < count; at += (int)strlen(command + at) + 1) {
    if (!strcmp(command + at, "--version")) operation = "version";
    if (!strcmp(command + at, "validate")) operation = "validate";
  }
  pid_t child = fork();
  if (child < 0) _exit(88);
  if (!child) {
    if (setsid() < 0) _exit(88);
    for (int fd = 0; fd < 1024; ++fd) close(fd);
    int nullfd = open("/dev/null", O_RDWR);
    if (nullfd != 0 || dup2(0, 1) != 1 || dup2(0, 2) != 2) _exit(88);
    execl("/bin/sleep", "sleep", "3600", (char *)NULL); _exit(88);
  }
  char own_ticks[64], child_ticks[64];
  for (int tries = 0; tries < 100 && (getsid(child) != child || ticks(child, child_ticks, sizeof(child_ticks))); ++tries)
    usleep(10000);
  if (getsid(child) != child || ticks(getpid(), own_ticks, sizeof(own_ticks)) ||
      ticks(child, child_ticks, sizeof(child_ticks))) _exit(88);
  char path[4096], temporary[4096], cwd[4096], scope[4096], status[65536], boot[128];
  if (!getcwd(cwd, sizeof(cwd)) || read_text("/proc/self/cgroup", scope, sizeof(scope)) < 0 ||
      read_text("/proc/self/status", status, sizeof(status)) < 0 ||
      read_text("/proc/sys/kernel/random/boot_id", boot, sizeof(boot)) < 0) _exit(88);
  scope[strcspn(scope, "\n")] = 0; boot[strcspn(boot, "\n")] = 0;
  if (snprintf(path, sizeof(path), "%s/.mesh-envoy-%s-%ld.json", cwd, marker, (long)getpid()) >= (int)sizeof(path) ||
      snprintf(temporary, sizeof(temporary), "%s.partial", path) >= (int)sizeof(temporary)) _exit(88);
  int fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) _exit(88); FILE *out = fdopen(fd, "w"); if (!out) _exit(88);
  fprintf(out, "{\"pid\":%ld,\"ticks\":", (long)getpid()); quoted(out, own_ticks);
  fputs(",\"operation\":", out); quoted(out, operation);
  fputs(",\"marker\":", out); quoted(out, marker); fputs(",\"frameEnv\":", out); quoted(out, frame);
  fputs(",\"scope\":", out); quoted(out, scope); fputs(",\"bootId\":", out); quoted(out, boot);
  fputs(",\"cwd\":", out); quoted(out, cwd); fputs(",\"home\":", out); quoted(out, getenv("HOME"));
  fputs(",\"status\":", out); quoted(out, status);
  fprintf(out, ",\"child\":{\"pid\":%ld,\"ticks\":", (long)child); quoted(out, child_ticks);
  fprintf(out, ",\"session\":%ld}}\n", (long)getsid(child));
  if (fflush(out) || fsync(fd) || fclose(out) || rename(temporary, path)) _exit(88);
  /* Leave the production ten-second version budget intact. This provides a
   * bounded window for a concurrent readonly native/kernel observation. */
  if (strcmp(operation, "service")) { struct timespec duration = { 3, 0 };
    while (nanosleep(&duration, &duration) && errno == EINTR) {} }
}
`;
const observer = String.raw`import glob,hashlib,json,os,re,signal,stat,struct,sys,time
r=json.load(sys.stdin)
assert len(json.dumps(r).encode())<=32768
identity=r['identity'];run=r['run']
assert re.fullmatch(r'default|[a-f0-9]{16}',identity['projectId'])
assert run['projectId']==identity['projectId'] and run['identityId']==identity['identityId']
assert re.fullmatch(r'sakura-(task|service)-[a-f0-9-]{36}',run['cgroupName'])
assert run['mode']=='inherit-current'

def read(path,limit=131072):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  raise ValueError('bounded observer')
 finally:os.close(fd)

def metadata(info):return {'device':str(info.st_dev),'inode':str(info.st_ino)}
def proc(pid):
 assert type(pid) is int and pid>1
 path='/proc/'+str(pid)
 try:
  before=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  if before[0] in (b'Z',b'X',b'x'):return None
  status=dict(row.split(':',1) for row in read(path+'/status',65536).decode().splitlines() if ':' in row)
  environment=dict(row.split('=',1) for row in read(path+'/environ').decode().split('\0') if '=' in row)
  descriptors=[os.readlink(path+'/fd/'+name) for name in os.listdir(path+'/fd') if os.path.exists(path+'/fd/'+name)]
  command=read(path+'/cmdline',65536).decode().split('\0');command=[v for v in command if v]
  result={'pid':pid,'ticks':before[19].decode(),'session':int(before[3]),'argv':command,
   'exe':os.readlink(path+'/exe'),'exeFile':metadata(os.stat(path+'/exe')),
   'uid':[int(v) for v in status['Uid'].split()],'gid':[int(v) for v in status['Gid'].split()],
   'groups':[int(v) for v in status['Groups'].split()],'home':environment.get('HOME'),
   'user':environment.get('USER'),'logname':environment.get('LOGNAME'),
   'marker':environment.get('SAKURA_MESH_UID_TEST'),'frameEnv':environment.get('SAKURA_MESH_FRAME_ENV'),
   'projectScope':environment.get('MESH_SCOPE'),
   'cwd':os.readlink(path+'/cwd'),'cwdFile':metadata(os.stat(path+'/cwd')),
   'scope':read(path+'/cgroup',4096).decode().strip(),'network':metadata(os.stat(path+'/ns/net')),
   'caps':{key:status[key].strip() for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs')},
   'authorityDescriptors':[v for v in descriptors if '/var/lib/sakura/project-identities' in v or
    '/run/sakura-guest-tasks/' in v or v.startswith('/sys/fs/cgroup/')],
   'secretMatches':bool(r.get('secret') and environment.get('TOKEN')==r['secret']),
   'secretInArgv':bool(r.get('secret') and r['secret'] in '\0'.join(command))}
  after=read(path+'/stat',4096).rsplit(b')',1)[1].split()
  assert before[19]==after[19] and after[0] not in (b'Z',b'X',b'x')
  return result
 except (FileNotFoundError,ProcessLookupError):return None

boot=read('/proc/sys/kernel/random/boot_id',128).decode().strip()
domain=None;members=[];reports=[]
group='/sys/fs/cgroup/'+run['cgroupName']
if os.path.lexists(group):
 for path in ['/','/sys','/sys/fs','/sys/fs/cgroup',group]:
  info=os.lstat(path);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 domain=metadata(os.lstat(group));assert domain=={'device':run['cgroupDevice'],'inode':run['cgroupInode']}
 assert boot==run['bootId']
 for file in glob.glob('/proc/[0-9]*/cgroup'):
  try:scope=read(file,4096).decode().strip()
  except (FileNotFoundError,ProcessLookupError):continue
  if scope=='0::/'+run['cgroupName'] or scope.startswith('0::/'+run['cgroupName']+'/'):
   value=proc(int(file.split('/')[2]))
   if value:members.append(value)
for name in os.listdir(identity['directory']):
 if not name.startswith('.mesh-envoy-'+r['marker']+'-') or not name.endswith('.json'):continue
 path=identity['directory']+'/'+name;info=os.lstat(path)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==identity['uid'] and info.st_gid==identity['gid'] and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600
 value=json.loads(read(path,131072))
 if value['scope']=='0::/'+run['cgroupName'] and value['bootId']==run['bootId']:reports.append(value)
children=[]
for child in r.get('children',[]):
 value=proc(child['pid'])
 children.append({'pid':child['pid'],'ticks':child['ticks'],
  'sameProcessAlive':bool(boot==run['bootId'] and value and value['ticks']==child['ticks']),'process':value})
listeners=[]
for value in members:
 if value['exe']!=r.get('binary',{}).get('path'):continue
 sockets=set()
 for name in os.listdir('/proc/'+str(value['pid'])+'/fd'):
  try:link=os.readlink('/proc/'+str(value['pid'])+'/fd/'+name)
  except (FileNotFoundError,ProcessLookupError):continue
  if re.fullmatch(r'socket:\[[0-9]+\]',link):sockets.add(link[8:-1])
 for family in ['tcp','tcp6']:
  for row in read('/proc/'+str(value['pid'])+'/net/'+family,131072).decode().splitlines()[1:]:
   fields=row.split()
   if len(fields)<10 or fields[3]!='0A' or fields[9] not in sockets:continue
   address,port=fields[1].split(':')
   listeners.append({'pid':value['pid'],'ticks':value['ticks'],'family':family,'address':address,'port':int(port,16),'socketInode':fields[9]})
config=None;service_owner=None;transport=None
service_folder='/run/sakura-project-mesh/'+identity['projectId']
service_owner_path=service_folder+'/owner.json'
if os.path.lexists(service_owner_path):
 info=os.lstat(service_owner_path)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and not stat.S_IMODE(info.st_mode)&0o077
 service_owner=json.loads(read(service_owner_path,8192))
input_path=service_folder+'/input-'+run['runId']+'.bin'
if os.path.lexists(input_path):
 info=os.lstat(input_path)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600
 raw=read(input_path,135168);offset=raw.find(b'SKIDP001');assert 0<offset<4096
 header=json.loads(raw[:offset].removesuffix(b'\\n').removesuffix(b'\n'))
 body=raw[offset:];version,flags=struct.unpack_from('<II',body,8)
 assert version==1 and flags==0 and len(body)==header['bytes'] and hashlib.sha256(body).hexdigest()==header['sha256']
 assert metadata(info)=={'device':header['fileDevice'],'inode':header['fileInode']}
 assert header['runId']==run['runId'] and header['bootId']==run['bootId'] and header['scopeName']==run['cgroupName']
 transport={'header':header,'bytes':len(body),'sha256':header['sha256'],'version':version,'flags':flags}
if r.get('config'):
 expected=r['config'];path=expected['path']
 if os.path.lexists(path):
  descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   info=os.fstat(descriptor);body=os.read(descriptor,16385)
   config={**metadata(info),'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body),
    'uid':info.st_uid,'gid':info.st_gid,'links':info.st_nlink,'mode':stat.S_IMODE(info.st_mode),
    'ownerPresent':os.path.lexists(path[:-5]+'.owner.json')}
  finally:os.close(descriptor)
if r['op']=='terminate-envoy':
 assert boot==run['bootId'] and domain is not None
 target=r['target'];value=proc(target['pid'])
 assert value and value['ticks']==target['ticks'] and value['scope']=='0::/'+run['cgroupName']
 assert value['uid']==[identity['uid']]*4 and value['gid']==[identity['gid']]*4
 assert value['exeFile']=={'device':r['binary']['device'],'inode':r['binary']['inode']}
 descriptor=os.pidfd_open(target['pid'],0)
 try:
  assert proc(target['pid'])==value
  signal.pidfd_send_signal(descriptor,signal.SIGTERM,None,0)
 finally:os.close(descriptor)
print(json.dumps({'bootId':boot,'domain':domain,'members':members,'reports':reports,'children':children,
 'listeners':listeners,'config':config,
 'configOwnerPresent':bool(r.get('config') and os.path.lexists(r['config']['path'][:-5]+'.owner.json')),
 'taskControlPresent':os.path.lexists('/run/sakura-guest-tasks/'+run['runId']),
 'serviceOwner':service_owner,'transport':transport}))
`;
const fixtureControl = String.raw`import hashlib,json,os,re,signal,stat,subprocess,sys,time
payload=sys.stdin.buffer.read(32769)
assert 0<len(payload)<=32768
r=json.loads(payload);invocation=r['invocation']
assert re.fullmatch(r'[a-f0-9-]{36}',invocation)
project=r.get('projectId','default');assert re.fullmatch(r'default|[a-f0-9]{16}',project)
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
base='/run/sakura-mesh-smoke/'+invocation

def trusted(path,mode=0o700,create=False):
 current=''
 for part in path.split('/')[1:]:
  current+='/'+part
  if create and not os.path.lexists(current):os.mkdir(current,mode if current==path else 0o755)
  info=os.lstat(current);assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 return info
def metadata(info):return {'device':str(info.st_dev),'inode':str(info.st_ino)}
def read(path,limit=32768):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(fd);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1
  body=os.read(fd,limit+1);assert len(body)<=limit
  return body,info
 finally:os.close(fd)
def write_new(path,body,mode):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,mode)
 try:
  offset=0
  while offset<len(body):offset+=os.write(fd,body[offset:])
  os.fsync(fd)
 finally:os.close(fd)
def process(pid):
 try:
  fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()
  if fields[0] in ('Z','X','x'):return None
  return {'pid':pid,'ticks':fields[19],'scope':open('/proc/'+str(pid)+'/cgroup').read().strip(),
   'uid':[int(v) for row in open('/proc/'+str(pid)+'/status') if row.startswith('Uid:') for v in row.split()[1:]]}
 except (FileNotFoundError,ProcessLookupError):return None

op=r['op']
if op in ('tamper','restore','config-read'):
 expected=r['config'];path=expected['path']
 assert path=='/etc/sakura/mesh-uid/'+project+'/'+r['runId']+'.json'
 trusted(os.path.dirname(path));body,info=read(path,16384)
 assert metadata(info)=={'device':expected['device'],'inode':expected['inode']}
 assert info.st_gid==expected['gid'] and stat.S_IMODE(info.st_mode)==0o440
 if op=='config-read':
  assert hashlib.sha256(body).hexdigest()==expected['sha256']
  print(json.dumps({'body':body.decode(),'proof':metadata(info)}))
 else:
  original=r['body'].encode();assert hashlib.sha256(original).hexdigest()==expected['sha256']
  assert body==(original if op=='tamper' else original+b' ')
  fd=os.open(path,os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   assert metadata(os.fstat(fd))==metadata(info)
   changed=original+b' ' if op=='tamper' else original
   offset=0
   while offset<len(changed):offset+=os.pwrite(fd,changed[offset:],offset)
   os.ftruncate(fd,len(changed));os.fsync(fd)
  finally:os.close(fd)
  print(json.dumps({'restored':op=='restore'}))
elif op in ('fixture-start','fixture-stop'):
 kind=r['kind'];assert kind in ('upstream','legacy')
 name='sakura-mesh-smoke-'+kind+'-'+invocation+'-'+project
 group='/sys/fs/cgroup/'+name;receipt=base+'/'+kind+'-'+project+'.json'
 trusted(base,create=True);trusted('/sys/fs/cgroup')
 if op=='fixture-start':
  assert not os.path.lexists(receipt) and not os.path.lexists(group)
  os.mkdir(group,0o700);info=trusted(group)
  owner={'version':1,'invocation':invocation,'projectId':project,'kind':kind,'bootId':boot,
   'group':name,'groupFile':metadata(info),'pid':None,'ticks':None,'config':None}
  if kind=='legacy':
   path='/etc/sakura/mesh/'+project+'.json';trusted(os.path.dirname(path),create=True)
   source=r['source'].encode();assert len(source)<=16384
   write_new(path,source,0o600)
   config_info=os.lstat(path);owner['config']={'path':path,**metadata(config_info),'sha256':hashlib.sha256(source).hexdigest()}
   argv=['/usr/local/bin/envoy','-c',path,'--disable-hot-restart','--concurrency','1','--log-level','warning']
  else:
   assert r['port']==18080 and len(r['directory'])<1024 and r['scope'] in ('host','alpha','beta')
   # Root receiver is a fixed fixture with inert response metadata. It never
   # exports a project environment or uses a project cwd.
   source="import http.server,json,os\nbody="+repr(json.dumps({'scope':r['scope'],'directory':r['directory']}))+"\n"+\
    "class Handler(http.server.BaseHTTPRequestHandler):\n def do_GET(self):\n  value=json.loads(body);value['namespace']=os.readlink('/proc/self/ns/net');data=json.dumps(value).encode()\n  self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)\n def log_message(self,*args):pass\nhttp.server.HTTPServer(('127.0.0.1',18080),Handler).serve_forever()\n"
   argv=['/usr/bin/python3','-I','-S','-u','-c',source]
  namespace=r['namespace']
  assert namespace in ('','sk-'+project)
  if namespace:argv=['/usr/sbin/ip','netns','exec',namespace]+argv
  write_new(receipt,json.dumps(owner,sort_keys=True).encode(),0o600)
  log=base+'/'+kind+'-'+project+'.log';logfd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
  def enter():
   os.chdir('/')
   descriptor=os.open(group+'/cgroup.procs',os.O_WRONLY|os.O_NOFOLLOW)
   try:os.write(descriptor,str(os.getpid()).encode())
   finally:os.close(descriptor)
  try:
   child=subprocess.Popen(argv,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'},
    stdin=subprocess.DEVNULL,stdout=logfd,stderr=logfd,close_fds=True,start_new_session=True,preexec_fn=enter)
  finally:os.close(logfd)
  value=process(child.pid);assert value and value['scope']=='0::/'+name and value['uid']==[0]*4
  owner['pid']=value['pid'];owner['ticks']=value['ticks']
  temporary=receipt+'.new';write_new(temporary,json.dumps(owner,sort_keys=True).encode(),0o600);os.replace(temporary,receipt)
  print(json.dumps(owner))
 else:
  expected=r.get('owner')
  if boot!=r['bootId']:
   assert not os.path.lexists(receipt) and not os.path.lexists(group)
   print(json.dumps({'retiredBoot':True,'groupAbsent':True}))
  elif not os.path.lexists(receipt):
   assert not os.path.lexists(group);print(json.dumps({'absent':True,'groupAbsent':True}))
  else:
   body,info=read(receipt);assert stat.S_IMODE(info.st_mode)==0o600
   owner=json.loads(body)
   assert owner['invocation']==invocation and owner['projectId']==project and owner['kind']==kind and owner['bootId']==boot and owner['group']==name
   if expected:assert owner==expected
   if os.path.lexists(group):
    assert metadata(trusted(group))==owner['groupFile']
    descriptor=os.open(group+'/cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW)
    try:os.write(descriptor,b'1')
    finally:os.close(descriptor)
    deadline=time.monotonic()+10
    while True:
     try:os.rmdir(group);break
     except OSError:
      assert time.monotonic()<deadline;time.sleep(.05)
   if kind=='legacy':
    config=owner['config'];body,info=read(config['path'],16384)
    assert metadata(info)=={'device':config['device'],'inode':config['inode']} and hashlib.sha256(body).hexdigest()==config['sha256']
    os.unlink(config['path'])
   os.unlink(receipt)
   print(json.dumps({'groupAbsent':not os.path.lexists(group),'pid':process(owner['pid']) if owner['pid'] else None}))
else:raise ValueError('fixed fixture operation required')
`;

const scenarios = ['reviewed directory migration', 'UID version and validate full tickets',
  'three namespaces with the same ports and real Envoy traffic', 'UID4/GID4/empty groups/HOME/cwd/net/caps/exe/PID ticks/listener',
  'protected environment and secret redaction', 'fixed root upstream and explicit loopback bridge',
  'live config guards', 'readonly reload', 'pause/resume on the original live', 'changed config retains exact receipts',
  'legacy root fixture is never adopted', 'detached UID descendant and neighbor retention',
  'cancellation after actual UID launch', 'polluted private route refusal', 'disabled settings',
  'cold boot readonly rejection and explicit original retirement', 'independent cleanup and actual child close'];

/**
 * 中文功能：核对并保存源码或二进制内容摘要，后续运行要求仍匹配原内容。
 * English: Check and retain source/binary content digests so later execution must match the original content.
 * 输入 / Inputs: path: string。
 * 结果：返回受控对象，公开字段包括 `path, sha256, device, inode, bytes, mtimeMs`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `path, sha256, device, inode, bytes, mtimeMs`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `realpath`, `lstat`, `assert.equal`, `before.isSymbolicLink`.
 * 检查边界 / Checked boundaries: `assert.equal(before.isSymbolicLink(), false)`; `assert.ok(before.isFile())`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function pin(path: string) {
  const actual = await realpath(path), before = await lstat(path);
  assert.equal(before.isSymbolicLink(), false); assert.ok(before.isFile());
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const after = await lstat(path);
  assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs], [before.dev, before.ino, before.size, before.mtimeMs]);
  return { path: actual, sha256: digest.digest('hex'), device: before.dev, inode: before.ino, bytes: before.size, mtimeMs: before.mtimeMs };
}

/**
 * 中文功能：枚举本用例核对范围内的源码或资源身份，形成后续固定来源清单。
 * English: Enumerate source/resource identities in this case's verification scope for subsequent source pinning.
 * 输入 / Inputs: disk: string。
 * 结果：返回分支计算值（`JSON.parse(value) as unknown[] / execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8', timeou…`）。
 * Result: Return the branch-computed value (`JSON.parse(value) as unknown[] / execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8', timeou…`).
 * 协作入口 / Collaborators: `disk.replaceAll`, `execFileSync`, `join`, `Buffer.from(source, 'utf16le').toString`.
 */
function inventory(disk: string) {
  const escaped = disk.replaceAll(',', ',,');
  const token = 'file=' + escaped + ',if=virtio,id=sakura-disk,format=qcow2';
  if (process.platform === 'win32') {
    const source = '$meshRequest=[Console]::In.ReadToEnd()|ConvertFrom-Json;' +
      '$meshOwned=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {' +
      '($_.Name -eq "sakura-qemu.exe" -or $_.Name -like "qemu-system*.exe") -and $_.CommandLine -and ' +
      '$_.CommandLine.Contains($meshRequest.token)}|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine);' +
      '[Console]::Write(ConvertTo-Json -InputObject $meshOwned -Compress -Depth 5)';
    const value = execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
      { input: JSON.stringify({ token }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return JSON.parse(value) as unknown[];
  }
  return execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8', timeout: 15000 }).split('\n')
    .filter(line => /^\s*\d+\s+\d+\s+(?:sakura-qemu|qemu-system\S*)\s/.test(line) && line.includes(token));
}
/**
 * 中文功能：构造本轮必须保持稳定的源码来源集合，供运行前后摘要核对。
 * English: Build the set of source origins that must remain stable for before/after digest checks.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`Object.fromEntries(await Promise.all(paths.map(async path => [path, await pin(re…`），以 Promise 交付。
 * Result: Return the branch-computed value (`Object.fromEntries(await Promise.all(paths.map(async path => [path, await pin(re…`) through a Promise.
 * 协作入口 / Collaborators: `Object.fromEntries`, `Promise.all`, `paths.map`.
 */
async function sourcePins() {
  const paths = ['scripts/smoke-service-mesh.ts', 'server/service-mesh.ts', 'server/service-mesh-identity.ts',
    'server/project-service-scope.ts', 'server/project-run-scope.ts', 'server/project-identity.ts', 'server/project-terminals.ts',
    'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await pin(resolve(path))])));
}
/**
 * 中文功能：申请并释放本机临时监听端口，取得当前可用的回环服务入口。
 * English: Bind and release a local temporary listener to obtain a currently available loopback service endpoint.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`port`），以 Promise 交付。
 * Result: Return the branch-computed value (`port`) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `server.address`.
 */
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); return port;
}

if (process.argv.includes('--describe')) {
  console.log(JSON.stringify({ version: 1, script: 'smoke-service-mesh', distro, envoyVersion, envoySha256, cache,
    scenarios, downloads: false, startsVm: false, retainedFixture: true, supported: Object.keys(images) }, null, 2));
} else {
  // Read-only preflight. No asset is downloaded and no existing user or historical
  // smoke fixture is opened. Running the script creates one fresh owned VM.
  const cachePin = await pin(cache); assert.equal(cachePin.sha256, envoySha256, 'Supply the pinned local Envoy cache first');
  const basePin = await pin(resolve('.data/images', images[distro])), initialSources = await sourcePins();
  if (process.argv.includes('--validate-only')) {
    console.log(JSON.stringify({ version: 1, distro, cache: cachePin, base: basePin, source: initialSources,
      startsVm: false, downloads: false, scenarios }, null, 2));
  } else await run(cachePin, basePin, initialSources);
}

/**
 * 中文功能：在自有项目和真实 VM 上装配网格、准备租约及身份任务，核对服务与有限任务的 UID、监听、清理和重启恢复。
 * English: Assemble mesh services, preparation leases and identity tasks in owned projects on a real VM, checking service/finite-task UID, listeners, cleanup and reboot recovery.
 * 输入 / Inputs: cachePin: Awaited<ReturnType<typeof pin>>; basePin: Awaited<ReturnType<typeof pin>>; initialSources: unknown。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `process.env.SAKURA_DATA_DIR`, `process.env.SAKURA_IMAGE_DIR`, `process.env.SAKURA_IMAGE_PATH`, `engine`, `proof.qemu`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new AggregateError([ ...(primary ? [new Error(scrub(primary))] : []), ...proof.cleanupErrors.map((it…`; `new AggregateError([ ...(primary ? [new Error(scrub(primary))] : []), ...proof.cleanupErrors.map((it…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `randomUUID`, `resolve`, `mkdir(directory, { recursive: false }).catch`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.ok(project.directory.startsWith(guest + '/'))`; `assert.equal(new Set([...identities.values()].map(v => v.uid)).size, 3)`.
 * 设计思路：区分宿主日志、客户机票据与内核进程观察，按完整身份关联边车和脱离父进程的孩子；业务失败与独立观察失败分别保存，原生产失败优先传播，最后清理仍保留失败证据。
 * Design: Keep host journals, guest tickets and kernel process observations separate, correlating sidecars and detached children by complete identity. Retain business and independent observation failures separately, propagate the original production failure first, and preserve failed evidence through final cleanup.
 */
async function run(cachePin: Awaited<ReturnType<typeof pin>>, basePin: Awaited<ReturnType<typeof pin>>, initialSources: unknown) {
  const invocation = randomUUID(), marker = 'mesh-uid-' + invocation;
  const frameEnv = 'protected UTF-8 春\nquote" apostrophe\' ' + invocation;
  const secret = 'sakura-mesh-secret-' + randomUUID();
  const directory = resolve('.data/service-mesh-identity-smoke', invocation);
  await mkdir(directory, { recursive: false }).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(directory), { recursive: true }); await mkdir(directory, { recursive: false });
  });
  const proofFile = join(directory, 'evidence-' + invocation + '.json');
  const proof: any = { version: 1, invocation, distro, directory, createdAt: new Date().toISOString(), retained: true,
    fixtureCreatedByThisInvocation: true, cache: cachePin, base: basePin, source: initialSources, scenarios,
    rootFixtures: [], taskRuns: [], services: [], events: [], cleanupErrors: [], qemuExecutions: [], inventories: [],
    rootCommandDigests: [], passed: false, proxyTrafficVerified: false, childCloseVerified: false };
  let queue = Promise.resolve(), primary: unknown;
  /**
   * 中文功能：从诊断文本移除本轮敏感标记，保持错误可读而不写出受保护值。
   * English: Remove this run's sensitive markers from diagnostics while keeping errors readable.
   * 输入 / Inputs: value: unknown。
   * 结果：返回分支计算值（`String(value instanceof Error ? value.stack || value.message : value).replaceAll…`）。
   * Result: Return the branch-computed value (`String(value instanceof Error ? value.stack || value.message : value).replaceAll…`).
   * 协作入口 / Collaborators: `String(value instanceof Error ? value.stack || value.message : value).repla…`, `String`.
   */
  const scrub = (value: unknown) => String(value instanceof Error ? value.stack || value.message : value).replaceAll(secret, '[redacted]');
  /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: value: unknown; depth = 0。
   * 结果：返回分支计算值（`({ text: scrub(value), status: (value as any)?.status, code: (value as any)?.cod…`）。
   * Result: Return the branch-computed value (`({ text: scrub(value), status: (value as any)?.status, code: (value as any)?.cod…`).
   * 协作入口 / Collaborators: `scrub`, `value.errors.map`, `describeError`.
   */
  const describeError = (value: unknown, depth = 0): any => ({
    text: scrub(value), status: (value as any)?.status, code: (value as any)?.code,
    ...(depth < 4 && value instanceof AggregateError ? { errors: value.errors.map(error => describeError(error, depth + 1)) } : {}),
    ...(depth < 4 && value instanceof Error && value.cause ? { cause: describeError(value.cause, depth + 1) } : {}),
  });
  /**
   * 中文功能：将当前证据写入本轮报告文件，以便保留成功、拒绝和清理结果。
   * English: Persist current evidence to this run's report so successes, refusals and cleanup outcomes are retained.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`queue`）。
   * Result: Return the branch-computed value (`queue`).
   * 状态影响 / State effects: `queue`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `JSON.stringify`, `assert.ok`, `bytes.includes`, `queue.catch(() => {}).then`.
   * 检查边界 / Checked boundaries: `assert.ok(!bytes.includes(secret), 'Secret entered smoke evidence')`.
   */
  const persist = () => {
    const bytes = JSON.stringify(proof, null, 2) + '\n';
    assert.ok(!bytes.includes(secret), 'Secret entered smoke evidence');
    queue = queue.catch(() => {}).then(() => writeFile(proofFile, bytes)); return queue;
  };
  await writeFile(join(directory, 'owned-fixture.json'), JSON.stringify({ version: 1, invocation, directory, proofFile,
    distro, originalUserInstance: false, retained: true, createdByThisInvocation: true }) + '\n', { flag: 'wx' });
  await persist();
  process.env.SAKURA_DATA_DIR = directory; process.env.SAKURA_IMAGE_DIR = dirname(basePin.path);
  process.env.SAKURA_IMAGE_PATH = basePin.path;

  const [{ Machines }, { createRuntime }, { Workspaces }, { ServiceMesh, envoySidecarConfig },
    { ProjectNetworkBridges }, { Secrets }, { ProjectDirectoryMigrations }, { ProjectIdentities },
    { ProjectRunScopes, projectIdentityTask }, { ProjectMeshScope }, { ProjectTerminals }, { vmDir }] = await Promise.all([
    import('../server/machines.ts'), import('../server/runtime.ts'), import('../server/workspaces.ts'),
    import('../server/service-mesh.ts'), import('../server/project-network-bridges.ts'), import('../server/secrets.ts'),
    import('../server/project-directory-migration.ts'), import('../server/project-identity.ts'),
    import('../server/project-run-scope.ts'), import('../server/project-service-scope.ts'),
    import('../server/project-terminals.ts'), import('../server/model.ts'),
  ]);
  let engine: Engine | undefined, machines: InstanceType<typeof Machines> | undefined;
  let workspaces: InstanceType<typeof Workspaces> | undefined, mesh: InstanceType<typeof ServiceMesh> | undefined;
  let bridges: InstanceType<typeof ProjectNetworkBridges> | undefined, preparation: InstanceType<typeof ProjectTerminals> | undefined;
  let core: InstanceType<typeof ProjectIdentities>, scopes: InstanceType<typeof ProjectRunScopes>;
  let vmId = '', disk = '', enabled = true, bootId = '', restoring: (/**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined;
  let restoreAudit: (/**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined, restoreInstall: (/**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined, readonlyPhase = false;
  const projects: string[] = [], fixtures = new Map<string, any>(), active = new Map<string, any>();
  const children = new Map<ChildProcess, Promise<void>>();
  const taskMonitors = new Set<Promise<void>>();
  const identities = new Map<string, ProjectIdentity>();

  /**
   * 中文功能：结束本轮拥有的运行或资源，按当前分支观察清理完成并保留失败证据。
   * English: Finalize runs/resources owned by this smoke, observe completion under the implemented branches and retain failed evidence.
   * 输入 / Inputs: name: string; operation: () => Promise<unknown>。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `operation`, `proof.cleanupErrors.push`, `describeError`, `persist`.
   */
  const clean = async (name: string, operation: /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<unknown>) => {
    try { await operation(); }
    catch (error) { proof.cleanupErrors.push({ component: name, error: describeError(error) }); await persist(); }
  };
  /**
   * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
   * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
   * 输入 / Inputs: operation: () => Promise<T>。
   * 结果：返回分支计算值（`await operation()`），以 Promise 交付。
   * Result: Return the branch-computed value (`await operation()`) through a Promise.
   * 状态影响 / State effects: `readonlyPhase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `operation`.
   */
  const readonlyOperation = async <T>(operation: /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<T>) => {
    readonlyPhase = true;
    try { return await operation(); } finally { readonlyPhase = false; }
  };
  /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: project: string; operation: () => Promise<T>。
   * 结果：返回分支计算值（`workspaces!.projects.with(vmId, project, operation)`）。
   * Result: Return the branch-computed value (`workspaces!.projects.with(vmId, project, operation)`).
   * 协作入口 / Collaborators: `workspaces!.projects.with`.
   */
  const within = <T>(project: string, operation: /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<T>) => workspaces!.projects.with(vmId, project, operation);
  /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: project: string; mode: 'start' | 'stop' | 'save'; signal: AbortSignal。
   * 结果：返回分支计算值（`within(project, () => mesh!.action(vmId, { mode, ...(mode === 'save' ? { policy …`）。
   * Result: Return the branch-computed value (`within(project, () => mesh!.action(vmId, { mode, ...(mode === 'save' ? { policy …`).
   * 协作入口 / Collaborators: `within`.
   */
  const action = (project: string, mode: 'start' | 'stop' | 'save', signal?: AbortSignal) =>
    within(project, () => mesh!.action(vmId, { mode, ...(mode === 'save' ? { policy } : {}) }, 'run', signal));
  /**
   * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
   * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
   * 输入 / Inputs: project: string。
   * 结果：返回分支计算值（`within(project, () => mesh!.status(vmId))`）。
   * Result: Return the branch-computed value (`within(project, () => mesh!.status(vmId))`).
   * 协作入口 / Collaborators: `within`.
   */
  const status = (project: string) => within(project, () => mesh!.status(vmId));
  /**
   * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
   * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
   * 输入 / Inputs: project: string。
   * 结果：返回分支计算值（`within(project, () => workspaces!.config(vmId))`）。
   * Result: Return the branch-computed value (`within(project, () => workspaces!.config(vmId))`).
   * 协作入口 / Collaborators: `within`.
   */
  const config = (project: string) => within(project, () => workspaces!.config(vmId));
  /**
   * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
   * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`JSON.parse(await readFile(join(directory, 'service-mesh.json'), 'utf8')) as any`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse(await readFile(join(directory, 'service-mesh.json'), 'utf8')) as any`) through a Promise.
   * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`.
   */
  const store = async () => JSON.parse(await readFile(join(directory, 'service-mesh.json'), 'utf8')) as any;
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `bootId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `machines!.start`, `Date.now`, `machines!.state`, `delay`.
   * 检查边界 / Checked boundaries: `assert.equal(machines!.state(vmId), 'running', machines!.logs.get(vmId))`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const boot = async () => {
    await machines!.start(vmId);
    const deadline = Date.now() + 300000;
    while (machines!.state(vmId) === 'starting' && Date.now() < deadline) await delay(100);
    assert.equal(machines!.state(vmId), 'running', machines!.logs.get(vmId));
    bootId = (await root('/bin/cat /proc/sys/kernel/random/boot_id')).trim();
    proof.events.push({ op: 'boot', bootId }); await persist();
  };
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: command: string; timeout = 15000。
   * 结果：返回分支计算值（`result.stdout.trim()`），以 Promise 交付。
   * Result: Return the branch-computed value (`result.stdout.trim()`) through a Promise.
   * 协作入口 / Collaborators: `assert.ok`, `command.includes`, `proof.rootCommandDigests.push`, `hash`.
   * 检查边界 / Checked boundaries: `assert.ok(!command.includes(secret) && !command.includes(frameEnv) && !command.includes(marker))`; `assert.equal(result.code, 0, scrub(result.stderr || result.stdout))`.
   */
  const root = async (command: string, timeout = 15000) => {
    assert.ok(!command.includes(secret) && !command.includes(frameEnv) && !command.includes(marker));
    proof.rootCommandDigests.push({ sha256: hash(command), mode: 'fixed administrator fixture', bootId });
    const result = await machines!.exec(vmId, rootEnvironment + '/bin/sh -c ' + quote('cd /\n' + command), timeout);
    assert.equal(result.code, 0, scrub(result.stderr || result.stdout)); return result.stdout.trim();
  };
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: metadata: object。
   * 结果：返回分支计算值（`JSON.parse(result.stdout)`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse(result.stdout)`) through a Promise.
   * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `assert.ok`, `machines!.execInput`.
   * 检查边界 / Checked boundaries: `assert.ok(input.length <= 32768)`; `assert.equal(result.code, 0, scrub(result.stderr))`.
   */
  const control = async (metadata: object) => {
    const input = Buffer.from(JSON.stringify({ invocation, ...metadata })); assert.ok(input.length <= 32768);
    const result = await machines!.execInput(vmId, rootEnvironment + '/usr/bin/python3 -I -S -c ' + quote(fixtureControl), input, 15000);
    assert.equal(result.code, 0, scrub(result.stderr)); return JSON.parse(result.stdout);
  };
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun; extras: object = {}。
   * 结果：返回分支计算值（`JSON.parse(result.stdout) as any`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse(result.stdout) as any`) through a Promise.
   * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `assert.ok`, `machines!.execInput`.
   * 检查边界 / Checked boundaries: `assert.ok(input.length <= 32768)`; `assert.equal(result.code, 0, scrub(result.stderr))`.
   */
  const observe = async (identity: ProjectIdentity, run: ProjectIdentityRun, extras: object = {}) => {
    const input = Buffer.from(JSON.stringify({ op: 'observe', identity, run, marker, ...extras }));
    assert.ok(input.length <= 32768);
    const result = await machines!.execInput(vmId, rootEnvironment + '/usr/bin/python3 -I -S -c ' + quote(observer), input, 15000);
    assert.equal(result.code, 0, scrub(result.stderr)); return JSON.parse(result.stdout) as any;
  };
  /**
   * 中文功能：将实际进程 UID 与项目身份和原运行票据关联核对，拒绝不匹配的观察值。
   * English: Cross-check observed process UID against project identity and its original run ticket, rejecting mismatched observations.
   * 输入 / Inputs: value: any; identity: ProjectIdentity; run: ProjectIdentityRun。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.deepEqual`, `assert.equal`, `assert.match`.
   * 检查边界 / Checked boundaries: `assert.deepEqual(value.uid, [identity.uid, identity.uid, identity.uid, identity.uid])`; `assert.deepEqual(value.gid, [identity.gid, identity.gid, identity.gid, identity.gid])`.
   */
  const assertUid = (value: any, identity: ProjectIdentity, run: ProjectIdentityRun) => {
    assert.deepEqual(value.uid, [identity.uid, identity.uid, identity.uid, identity.uid]);
    assert.deepEqual(value.gid, [identity.gid, identity.gid, identity.gid, identity.gid]); assert.deepEqual(value.groups, []);
    assert.equal(value.home, identity.home); assert.equal(value.user, identity.account); assert.equal(value.logname, identity.account);
    assert.equal(value.cwd, identity.directory); assert.deepEqual(value.cwdFile, { device: identity.directoryDevice, inode: identity.directoryInode });
    assert.equal(value.marker, marker); assert.equal(value.frameEnv, frameEnv); assert.equal(value.scope, '0::/' + run.cgroupName);
    assert.equal(value.projectScope, identity.projectId === 'default' ? 'host' : identity.projectId === proof.alpha ? 'alpha' : 'beta');
    assert.deepEqual(value.network, { device: run.networkDevice, inode: run.networkInode });
    for (const cap of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(value.caps[cap], /^0+$/);
    assert.equal(value.caps.NoNewPrivs, '1'); assert.deepEqual(value.authorityDescriptors, []); assert.equal(value.secretInArgv, false);
  };
  /**
   * 中文功能：断言原运行的进程、作用域或资源已经消失，具体对象由传入观察值规定。
   * English: Assert that the original run's processes/scopes/resources are absent, with the observation defining the checked objects.
   * 输入 / Inputs: value: any。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`.
   * 检查边界 / Checked boundaries: `assert.equal(value.domain, null)`; `assert.deepEqual(value.members, [])`.
   */
  const assertGone = (value: any) => {
    assert.equal(value.domain, null); assert.deepEqual(value.members, []); assert.equal(value.taskControlPresent, false);
    for (const child of value.children) assert.equal(child.sameProcessAlive, false);
  };
  /**
   * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
   * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
   * 输入 / Inputs: projectId: string; runId: string。
   * 结果：返回分支计算值（`current / JSON.parse(await readFile(join(vmDir(vmId), 'project-identities', projectId, 'cl…`），以 Promise 交付。
   * Result: Return the branch-computed value (`current / JSON.parse(await readFile(join(vmDir(vmId), 'project-identities', projectId, 'cl…`) through a Promise.
   * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`, `vmDir`.
   */
  const hostEntry = async (projectId: string, runId: string) => {
    const journal = JSON.parse(await readFile(join(vmDir(vmId), 'project-identities', projectId + '.json'), 'utf8'));
    const current = journal.runs.find((v: any) => v.runId === runId);
    if (current) return current;
    return JSON.parse(await readFile(join(vmDir(vmId), 'project-identities', projectId, 'closed-runs', runId + '.json'), 'utf8'));
  };
  /**
   * 中文功能：将网格公共状态、持久运行、身份控制器、宿主账本和内核边车/孩子观察交叉核对。
   * English: Cross-check mesh public state, persisted run, identity controller, host ledger and kernel sidecar/child observations.
   * 输入 / Inputs: projectId: string。
   * 结果：返回分支计算值（`captured`），以 Promise 交付。
   * Result: Return the branch-computed value (`captured`) through a Promise.
   * 协作入口 / Collaborators: `status`, `(await store()).runs.find`, `store`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.ok(view.bindingValid && view.sidecarRunning)`; `assert.ok(row?.execution.run)`.
   * 设计思路：核对 Envoy 可执行文件 device/inode、固定 argv、监听者出生身份和项目 UID，保存完整 captured 对象用于后续停止证明，而不是只检查服务端口可达。
   * Design: Check Envoy executable device/inode, fixed argv, listener birth identity and project UID, retaining a complete captured object for later stop proof instead of relying on port reachability.
   */
  const proveService = async (projectId: string) => {
    const view = await status(projectId), row = (await store()).runs.find((v: any) => v.projectId === projectId);
    assert.ok(view.bindingValid && view.sidecarRunning); assert.ok(row?.execution.run);
    assert.equal(row.execution.record.runId, view.runId); assert.equal(row.execution.record.scopeName, 'sakura-service-' + view.runId);
    const native = await core.runReadonly(vmId, row.execution.identity, view.runId!);
    assert.deepEqual(native, row.execution.run); assert.equal(native.phase, 'active');
    const entry = await hostEntry(projectId, view.runId!);
    assert.equal(entry.owner.kind, 'service'); assert.deepEqual(entry.run, native); assert.equal(entry.sha256, row.execution.sha256);
    const observation = await observe(row.execution.identity, native, { binary: row.binary, config: row.config,
      ...(projectId === proof.alpha && proof.secretsVerified ? { secret } : {}) });
    assert.equal(observation.bootId, native.bootId);
    const envoy = observation.members.filter((v: any) => v.exe === row.binary.path);
    assert.equal(envoy.length, 1); assertUid(envoy[0], row.execution.identity, native);
    assert.deepEqual(envoy[0].exeFile, { device: row.binary.device, inode: row.binary.inode });
    assert.deepEqual(envoy[0].argv, [row.binary.path, '-c', row.config.path, '--disable-hot-restart', '--concurrency', '1', '--log-level', 'warning']);
    assert.deepEqual(view.processes, [envoy[0].pid]);
    assert.deepEqual(observation.listeners, [{ pid: envoy[0].pid, ticks: envoy[0].ticks, family: 'tcp',
      address: '0100007F', port: policy.listenPort, socketInode: row.listener.socketInode }]);
    assert.deepEqual(row.listener, { pid: envoy[0].pid, startTicks: envoy[0].ticks, port: policy.listenPort, socketInode: row.listener.socketInode });
    assert.deepEqual(observation.config, { device: row.config.device, inode: row.config.inode, sha256: row.config.sha256,
      bytes: row.config.bytes, uid: 0, gid: row.execution.identity.gid, links: 1, mode: 0o440, ownerPresent: true });
    assert.equal(observation.configOwnerPresent, true);
    assert.deepEqual(observation.serviceOwner, row.execution.record);
    assert.equal(observation.transport.sha256, row.execution.sha256);
    assert.equal(observation.transport.flags, 0);
    const reports = observation.reports.filter((v: any) => v.operation === 'service');
    assert.equal(reports.length, 1); assert.equal(reports[0].pid, envoy[0].pid); assert.equal(reports[0].ticks, envoy[0].ticks);
    const child = observation.members.find((v: any) => v.pid === reports[0].child.pid);
    assert.ok(child); assertUid(child, row.execution.identity, native);
    assert.equal(child.ticks, reports[0].child.ticks); assert.equal(child.session, child.pid);
    if (projectId === proof.alpha && proof.secretsVerified) assert.equal(envoy[0].secretMatches, true);
    const captured = { row: structuredClone(row), observation, child: reports[0].child, envoy: envoy[0] };
    active.set(projectId, captured); proof.services.push(captured); await persist(); return captured;
  };
  /**
   * 中文功能：依据 captured 原票据核对整个服务域和配置传输已消失，校验原宿主/客户机记录的退役状态。
   * English: Use the captured original ticket to verify whole-service-domain/configuration/transport disappearance and original host/guest record retirement.
   * 输入 / Inputs: captured: any; reboot = false。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `observe`, `assertGone`, `assert.equal`, `assert.deepEqual`.
   * 检查边界 / Checked boundaries: `assert.equal(stopped.config, null)`; `assert.equal(stopped.configOwnerPresent, false)`.
   * 设计思路：正常停止应写 closed 原运行，客户机重启则保留原票据并记录新 boot 的退役原因；两种路径分别校验，避免以新身份覆盖旧清理证据。
   * Design: Normal stop closes the original run, while guest reboot retains its original ticket with a new-boot retirement reason. Verify both paths separately rather than replacing old cleanup evidence with new identity.
   */
  const proveStopped = async (captured: any, reboot = false) => {
    const { row } = captured, identity = row.execution.identity, original = row.execution.run;
    const stopped = await observe(identity, original, { binary: row.binary, config: row.config, children: [captured.child] });
    assertGone(stopped); assert.equal(stopped.config, null); assert.equal(stopped.configOwnerPresent, false);
    assert.equal(stopped.transport, null);
    if (reboot) assert.equal(stopped.serviceOwner, null);
    else assert.deepEqual(stopped.serviceOwner, { ...row.execution.record, phase: 'stopped' });
    const entry = await hostEntry(row.projectId, original.runId); assert.equal(entry.phase, 'closed');
    assert.deepEqual(entry.identity, identity); assert.equal(entry.sha256, row.execution.sha256);
    if (reboot) {
      assert.notEqual(stopped.bootId, original.bootId); assert.deepEqual(entry.run, original);
      assert.deepEqual(entry.retirement, { reason: 'guest-reboot', bootId: stopped.bootId });
    } else {
      const native = await core.runReadonly(vmId, identity, original.runId);
      assert.deepEqual(native, { ...original, phase: 'closed' }); assert.deepEqual(entry.run, native);
    }
    assert.ok(!(await store()).runs.some((v: any) => v.id === row.id));
    const scope = new ProjectMeshScope(machines!, vmId, await config(row.projectId));
    const record = await scope.metadata(); assert.ok(record);
    assert.deepEqual(record, { ...row.execution.record, phase: 'stopped' });
    proof.events.push({ op: 'whole-domain-stopped', original: row.execution, observation: stopped, host: entry, reboot }); await persist();
    active.delete(row.projectId);
  };
  /**
   * 中文功能：结束本轮拥有的运行或资源，按当前分支观察清理完成并保留失败证据。
   * English: Finalize runs/resources owned by this smoke, observe completion under the implemented branches and retain failed evidence.
   * 输入 / Inputs: projectId: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `active.get`, `action`, `proveStopped`.
   */
  const stop = async (projectId: string) => {
    const captured = active.get(projectId); await action(projectId, 'stop');
    if (captured) await proveStopped(captured);
  };

  // Delegate unchanged public finite execution. Only receipt hooks and readonly
  // observations are added; the protected execution, environment and SHA are
  // never replaced or reconstructed by this smoke.
  /**
   * 中文功能：包装真实身份任务，观察持久意图、active 内核进程和 closed 清理证明；正常收尾后返回生产结果或传播失败。
   * English: Wrap a real identity task to observe durable intent, active kernel processes and closed cleanup proof; return its production result or propagate failures after successful finalization.
   * 输入 / Inputs: ownerMachines; ownerVm; project; execution; signal; log; timeout; agent; afterCleanup; options = {}。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 状态影响 / State effects: `result`, `failure`, `done`, `evidence.result`, `evidence.closed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `failure`; `verificationFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.equal`, `execution.command.includes`, `projectIdentityTask`, `scrub`.
   * 检查边界 / Checked boundaries: `assert.equal(readonlyPhase, false, 'Readonly mesh operation issued a finite task')`; `assert.ok(closed)`.
   * 设计思路：beforeIntent 先核对持久任务与完整身份再启动独立监控，finally 结束监控。正常完成监控和持久化收尾后，按生产 failure、证据 verificationFailure 的顺序传播；监控或持久化自身拒绝仍可中断收尾并遮盖先前失败。
   * Design: beforeIntent verifies durable tasks/full identity before independent monitoring, which finally ends. After monitoring and persistence finalize successfully, propagate production failure before evidence verificationFailure; monitoring or persistence rejections can still interrupt finalization and supersede an earlier failure.
   */
  const runTask: NonNullable<ServiceMeshOptions['runTask']> = async (ownerMachines, ownerVm, project, execution, signal,
    log, timeout, agent, afterCleanup, options = {}) => {
    assert.equal(readonlyPhase, false, 'Readonly mesh operation issued a finite task');
    let done = false, evidence: any, monitoring: Promise<void> | undefined, failure: unknown, verificationFailure: unknown;
    let result: Awaited<ReturnType<typeof projectIdentityTask>> | undefined;
    const kind = execution.command.includes('--version') ? 'version' : 'validate';
    try {
      result = await projectIdentityTask(ownerMachines, ownerVm, project, execution, signal, log, timeout, agent, afterCleanup, {
        ...options, /**
         * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
         * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
         * 输入 / Inputs: value。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `evidence`, `monitoring`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `options.beforeIntent`, `(await store()).tasks.find`, `store`, `assert.ok`.
         * 检查边界 / Checked boundaries: `assert.ok(stored)`; `assert.deepEqual(stored.identity, value.identity)`.
         * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
         * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
         */
        beforeIntent: async value => {
          await options.beforeIntent?.(value);
          const stored = (await store()).tasks.find((v: any) => v.owner.runId === value.owner.runId);
          assert.ok(stored); assert.deepEqual(stored.identity, value.identity); assert.deepEqual(stored.owner, value.owner);
          assert.equal(stored.sha256, value.sha256);
          evidence = { kind, intent: structuredClone(value), meshTask: stored, active: null, native: null, closed: null };
          proof.taskRuns.push(evidence); await persist();
          monitoring = (/**
           * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
           * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 状态影响 / State effects: `evidence.native`, `evidence.active`, `evidence.child`, `evidence.lastObservationError`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
           * 协作入口 / Collaborators: `core.runReadonly`, `delay`, `assert.equal`, `observe`.
           * 检查边界 / Checked boundaries: `assert.equal(native.cgroupName, 'sakura-task-' + value.owner.runId)`; `assert.equal(native.bootId, value.owner.bootId)`.
           * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
           * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
           */
          async () => {
            while (!done) {
              try {
                const native = await core.runReadonly(vmId, value.identity, value.owner.runId);
                if (native.phase !== 'active') { await delay(50); continue; }
                assert.equal(native.cgroupName, 'sakura-task-' + value.owner.runId); assert.equal(native.bootId, value.owner.bootId);
                const observed = await observe(value.identity, native, { binary: { path: '/usr/local/bin/envoy' },
                  ...(value.identity.projectId === proof.alpha && proof.secretsVerified ? { secret } : {}) });
                const report = observed.reports.find((v: any) => v.operation === kind);
                const envoy = observed.members.find((v: any) => report && v.pid === report.pid && v.ticks === report.ticks);
                if (report && envoy) {
                  assertUid(envoy, value.identity, native); assert.equal(envoy.exe, '/usr/local/bin/envoy');
                  const child = observed.members.find((v: any) => v.pid === report.child.pid);
                  assert.ok(child); assertUid(child, value.identity, native);
                  assert.equal(child.ticks, report.child.ticks); assert.equal(child.session, child.pid);
                  if (kind === 'version') assert.deepEqual(envoy.argv, ['/usr/local/bin/envoy', '--version']);
                  else { assert.equal(envoy.argv[1], '--mode'); assert.equal(envoy.argv[2], 'validate'); }
                  if (value.identity.projectId === proof.alpha && proof.secretsVerified) assert.equal(envoy.secretMatches, true);
                  evidence.native = native; evidence.active = observed; evidence.child = report.child; await persist(); return;
                }
              } catch (error) {
                // A ticket is normally absent while its durable intent precedes
                // launch. Record the last error; never change production state.
                evidence.lastObservationError = scrub(error);
              }
              await delay(50);
            }
          })().finally(() => { if (monitoring) taskMonitors.delete(monitoring); });
          taskMonitors.add(monitoring);
        },
      });
    } catch (error) { failure = error; }
    finally {
      done = true; await monitoring;
      if (evidence) try {
        evidence.result = result ? { code: result.code, stdout: scrub(result.stdout), stderr: scrub(result.stderr) } : { error: scrub(failure) };
        const closed = await scopes.taskRun(vmId, evidence.intent.identity.projectId, evidence.intent.owner.runId);
        assert.ok(closed); assert.equal(closed.phase, 'closed'); assert.ok(closed.run, 'Finite execution must issue a real native full ticket');
        assert.deepEqual(closed.identity, evidence.intent.identity); assert.deepEqual(closed.owner, evidence.intent.owner);
        assert.equal(closed.sha256, evidence.intent.sha256);
        const native = await core.runReadonly(vmId, closed.identity, closed.owner.runId);
        assert.equal(native.phase, 'closed'); assert.deepEqual(native, closed.run);
        if (evidence.native) assert.deepEqual(native, { ...evidence.native, phase: 'closed' });
        const gone = await observe(closed.identity, closed.run!, { children: evidence.child ? [evidence.child] : [] });
        assertGone(gone); evidence.closed = { host: closed, native, observation: gone };
        const incompatible = distro === 'alpine' && result && result.code !== 0 && /symbol not found/.test(result.stderr);
        assert.ok(evidence.active || incompatible, 'Actual UID Envoy process was not observed; this smoke cannot claim UID version/validation passed');
        if (incompatible && !evidence.active) evidence.envoyProcessVerified = false;
        await persist();
      } catch (error) { verificationFailure = error; evidence.verificationError = describeError(error); await persist(); }
    }
    // Preserve the production cancellation/status/exit result when it failed;
    // the independent evidence keeps every observation/cleanup failure.
    if (failure) throw failure; if (verificationFailure) throw verificationFailure; assert.ok(result); return result;
  };
  /**
   * 中文功能：准备或启动本轮自有客户机/项目资源，交付下述实际回执给后续验证。
   * English: Prepare/start guest or project resources owned by this smoke and supply the actual receipt below to later checks.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new ServiceMesh(machines!, workspaces!, undefined, async () => enabled, { runTas…`）。
   * Result: Return the branch-computed value (`new ServiceMesh(machines!, workspaces!, undefined, async () => enabled, { runTas…`).
   */
  const create = () => new ServiceMesh(machines!, workspaces!, undefined, async () => enabled, { runTask });
  /**
   * 中文功能：准备或启动本轮自有客户机/项目资源，交付下述实际回执给后续验证。
   * English: Prepare/start guest or project resources owned by this smoke and supply the actual receipt below to later checks.
   * 输入 / Inputs: projectId: string; kind: 'upstream' | 'legacy'; scope: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `config`, `JSON.stringify`, `envoySidecarConfig`, `fixtures.set`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const startFixture = async (projectId: string, kind: 'upstream' | 'legacy', scope: string) => {
    const project = await config(projectId), key = kind + ':' + projectId;
    const request = { op: 'fixture-start', kind, projectId, namespace: project.networkIsolation === 'private' ? 'sk-' + projectId : '',
      directory: project.directory, scope, port: policy.upstreamPort, source: JSON.stringify(envoySidecarConfig(policy)) };
    fixtures.set(key, { bootId, owner: null, projectId, kind });
    const owner = await control(request); fixtures.set(key, { bootId, owner, projectId, kind });
    proof.rootFixtures.push({ purpose: kind === 'upstream' ? 'fixed root HTTP receiver, not UID Envoy proof' : 'known root legacy fixture, never adopted', owner });
    await persist();
  };
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: key: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixtures.get`, `control`, `assert.equal`, `assert.notEqual`.
   * 检查边界 / Checked boundaries: `assert.equal(result.groupAbsent, true)`; `assert.notEqual(result.pid.ticks, item.owner.ticks)`.
   */
  const stopFixture = async (key: string) => {
    const item = fixtures.get(key); if (!item) return;
    const result = await control({ op: 'fixture-stop', ...item }); assert.equal(result.groupAbsent, true);
    if (result.pid) assert.notEqual(result.pid.ticks, item.owner.ticks);
    proof.events.push({ op: 'fixed-root-fixture-stopped', owner: item.owner, result }); fixtures.delete(key); await persist();
  };
  /**
   * 中文功能：取得当前项目准备租约，以捕获的 live/boot 身份执行有限 HTTP 客户端任务，最后释放租约。
   * English: Acquire the current project preparation lease and run a finite HTTP-client task with captured live/boot identity, then release the lease.
   * 输入 / Inputs: projectId: string; command: string。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 协作入口 / Collaborators: `preparation!.prepare`, `assert.ok`, `assert.equal`, `machines!.live.get`.
   * 检查边界 / Checked boundaries: `assert.ok(lease.captured && lease.signal)`; `assert.equal(machines!.live.get(vmId), captured.live)`.
   * 设计思路：执行前后均核对原 live 对象，beforeIntent 保存运行身份与摘要；租约释放放在 finally，使失败也进入同一归属收尾。
   * Design: Check the original live object before/after execution and record identity/digest in beforeIntent. Finally releases the lease so failures share the same ownership finalization.
   */
  const client = async (projectId: string, command: string) => {
    const lease = await preparation!.prepare(vmId, projectId, null, false, undefined, undefined, { mode: 'task' });
    assert.ok(lease.captured && lease.signal); const captured = lease.captured;
    try {
      assert.equal(machines!.live.get(vmId), captured.live);
      const identity = await core.inspect(vmId, projectId); assert.ok(identity);
      const result = await projectIdentityTask(machines!, vmId, captured.project, { command }, lease.signal!, undefined, 10000,
        undefined, undefined, { expectedLive: captured.live, expectedBootId: bootId, /**
         * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
         * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
         * 输入 / Inputs: value。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `proof.events.push`.
         */
        beforeIntent: async value => {
          proof.events.push({ op: 'UID-fixed-http-client-intent', identity: value.identity, owner: value.owner, sha256: value.sha256 });
        } });
      assert.equal(machines!.live.get(vmId), captured.live); return result;
    } finally { await lease.release(); }
  };
  /**
   * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
   * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
   * 输入 / Inputs: projectId: string; scope: string。
   * 结果：返回分支计算值（`value as { scope: string; directory: string; namespace: string }`），以 Promise 交付。
   * Result: Return the branch-computed value (`value as { scope: string; directory: string; namespace: string }`) through a Promise.
   * 协作入口 / Collaborators: `Date.now`, `client`, `quote`, `JSON.parse`.
   * 检查边界 / Checked boundaries: `assert.equal(value.scope, scope)`; `assert.equal(value.directory, (await config(projectId)).directory)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const response = async (projectId: string, scope: string) => {
    const source = 'import urllib.request\nprint(urllib.request.urlopen("http://127.0.0.1:15001",timeout=2).read().decode())';
    const deadline = Date.now() + 20000;
    while (true) {
      const result = await client(projectId, 'exec /usr/bin/python3 -I -S -c ' + quote(source));
      if (result.code === 0) {
        const value = JSON.parse(result.stdout); assert.equal(value.scope, scope); assert.equal(value.directory, (await config(projectId)).directory);
        return value as { scope: string; directory: string; namespace: string };
      }
      assert.ok(Date.now() < deadline, scrub(result.stderr)); await delay(100);
    }
  };

  try {
    engine = await createRuntime();
    const originalRun = engine.run, qemuPin = await pin(resolve(process.env.SAKURA_QEMU_DIR || '.tools/qemu',
      'qemu-system-x86_64' + (process.platform === 'win32' ? '.exe' : '')));
    proof.qemu = qemuPin; proof.runtimeVersion = engine.version;
    // Track the actual QEMU child, its close event and both output pipes. The
    // engine's other administration tools retain their normal runtime adapter.
    engine.run = /**
     * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
     * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
     * 输入 / Inputs: tool; args; options = {}。
     * 结果：返回分支计算值（`originalRun(tool, args, options) / ''`），以 Promise 交付。
     * Result: Return the branch-computed value (`originalRun(tool, args, options) / ''`) through a Promise.
     * 状态影响 / State effects: `receipt.pid`, `receipt.settled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `args.includes`, `originalRun`, `assert.ok`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.ok(disk)`; `assert.equal(inventory(disk).length, 0)`.
     * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
     * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
     */
    async (tool, args, options = {}) => {
      if (tool !== 'sakura-qemu' || !args.includes('-drive')) return originalRun(tool, args, options);
      assert.ok(disk); assert.equal(inventory(disk).length, 0);
      assert.deepEqual(await pin(qemuPin.path), qemuPin); assert.deepEqual(await pin(basePin.path), basePin);
      const expected = 'file=' + disk.replaceAll(',', ',,') + ',if=virtio,id=sakura-disk,format=qcow2';
      const drives = args.flatMap((v, i) => v === '-drive' ? [args[i + 1]] : []);
      assert.equal(drives.length, 2); assert.ok(drives[0].startsWith(expected + ',cache='));
      assert.ok(!args.includes('-snapshot') && !args.includes('-incoming'));
      const receipt: any = { pid: null, argv: [...args], startedAt: new Date().toISOString(), exit: null, close: false,
        stdoutClosed: false, stderrClosed: false, settled: false, diskBefore: await pin(disk) };
      proof.qemuExecutions.push(receipt); await persist();
      const child = spawn(qemuPin.path, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); receipt.pid = child.pid;
      let failure: Error | undefined, stderr = '';
      child.once('error', error => { failure = error; });
      child.stdout!.on('data', data => options.output?.(data));
      child.stderr!.on('data', data => { options.output?.(data); stderr = (stderr + data.toString()).slice(-8192); });
      child.once('exit', (code, signal) => { receipt.exit = { code, signal, at: new Date().toISOString() }; });
      const closed = new Promise<void>(done => child.once('close', (code, signal) => {
        receipt.close = true; receipt.code = code; receipt.signal = signal;
        receipt.stdoutClosed = child.stdout!.closed; receipt.stderrClosed = child.stderr!.closed; children.delete(child); done();
      })); children.set(child, closed);
      /**
       * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
       * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`child.kill()`）。
       * Result: Return the branch-computed value (`child.kill()`).
       * 协作入口 / Collaborators: `child.kill`.
       */
      const abort = () => child.kill(); options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      try { await closed; if (failure) throw failure; if (options.signal?.aborted) return '';
        assert.equal(receipt.code, 0, scrub(stderr)); return ''; }
      finally { receipt.settled = true; options.signal?.removeEventListener('abort', abort); await persist(); }
    };
    machines = new Machines(engine); await machines.init();
    const vm = await machines.create({ name: 'service-mesh-uid-' + distro + '-' + invocation.slice(0, 8), distro,
      memoryMiB: 2048, cpus: 2, diskGiB: 8, accelerator: 'auto', forwards: [] });
    vmId = vm.id; disk = join(vmDir(vmId), 'disk.qcow2'); proof.vmId = vmId; proof.disk = disk;
    const originalExec = machines.exec.bind(machines), originalInput = machines.execInput.bind(machines);
    /**
     * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
     * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
     * 输入 / Inputs: id: string; command: string; input: Buffer。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `command.includes`, `proof.rootCommandDigests.push`.
     * 检查边界 / Checked boundaries: `assert.equal(id, vmId, 'Smoke operation escaped its own fixture')`; `assert.ok(!command.includes(secret) && !command.includes(marker) && !command.includes(frameEnv), 'Project body or environment ente…`.
     */
    const audit = (id: string, command: string, input?: Buffer) => {
      assert.equal(id, vmId, 'Smoke operation escaped its own fixture');
      assert.ok(!command.includes(secret) && !command.includes(marker) && !command.includes(frameEnv), 'Project body or environment entered root argv');
      proof.rootCommandDigests.push({ sha256: hash(command), inputSha256: input ? hash(input) : null, inputBytes: input?.length || 0, readonlyPhase });
    };
    machines.exec = /**
     * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
     * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
     * 输入 / Inputs: args: Parameters<typeof originalExec>。
     * 结果：返回分支计算值（`originalExec(...args)`），以 Promise 交付。
     * Result: Return the branch-computed value (`originalExec(...args)`) through a Promise.
     * 协作入口 / Collaborators: `audit`, `originalExec`.
     */
    async (...args: Parameters<typeof originalExec>) => { audit(args[0], args[1]); return originalExec(...args); };
    machines.execInput = /**
     * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
     * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
     * 输入 / Inputs: args: Parameters<typeof originalInput>。
     * 结果：返回分支计算值（`originalInput(...args)`），以 Promise 交付。
     * Result: Return the branch-computed value (`originalInput(...args)`) through a Promise.
     * 协作入口 / Collaborators: `audit`, `originalInput`.
     */
    async (...args: Parameters<typeof originalInput>) => { audit(args[0], args[1], args[2]); return originalInput(...args); };
    restoreAudit = /**
     * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
     * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `machines!.exec`, `machines!.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    () => { machines!.exec = originalExec; machines!.execInput = originalInput; };
    const originalInstall = ProjectIdentities.prototype.install;
    ProjectIdentities.prototype.install = /**
     * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
     * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
     * 输入 / Inputs: args: Parameters<typeof originalInstall>。
     * 结果：返回分支计算值（`originalInstall.apply(this, args)`），以 Promise 交付。
     * Result: Return the branch-computed value (`originalInstall.apply(this, args)`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `originalInstall.apply`.
     * 检查边界 / Checked boundaries: `assert.equal(readonlyPhase, false, 'Readonly mesh operation attempted native installation')`.
     */
    async function (...args: Parameters<typeof originalInstall>) {
      assert.equal(readonlyPhase, false, 'Readonly mesh operation attempted native installation'); return originalInstall.apply(this, args);
    };
    restoreInstall = /**
     * 中文功能：读取当前自有项目、运行或状态证据，供相邻真实环境断言核对。
     * English: Read current owned-project/run/state evidence for adjacent real-environment assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `ProjectIdentities.prototype.install`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    () => { ProjectIdentities.prototype.install = originalInstall; };
    proof.inventories.push({ at: 'before-owned-start', disk, processes: inventory(disk) }); await persist(); await boot();
    // Explicit instance administration on this new owned fixture. Native
    // installation also stays on its production administrator API.
    await root(distro === 'alpine'
      ? 'apk add --no-cache python3 tmux iproute2 libstdc++ gcompat build-base'
      : 'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && ' +
        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y python3 tmux iproute2 libstdc++6 libgcc-s1 gcc libc6-dev', 240000);
    await machines.sftp(vmId, async ftp => pipeline(createReadStream(cachePin.path), ftp.createWriteStream('/usr/local/bin/envoy', { flags: 'wx', mode: 0o755 })));
    await root('test "$(sha256sum /usr/local/bin/envoy | cut -d\' \' -f1)" = ' + envoySha256);
    const libraryDirectory = '/usr/local/lib/sakura-mesh-smoke/' + invocation, library = libraryDirectory + '/uid-probe.so';
    await root('mkdir -p ' + quote(libraryDirectory) + '\nchmod 755 ' + quote(libraryDirectory));
    await machines.sftp(vmId, async ftp => {
      const stream = ftp.createWriteStream(libraryDirectory + '/uid-probe.c', { flags: 'wx', mode: 0o644 });
      await new Promise<void>((done, fail) => { stream.once('error', fail); stream.once('close', done); stream.end(uidProbe); });
    });
    await root('cc -shared -fPIC -O2 -Wall -Wextra -o ' + quote(library) + ' ' + quote(libraryDirectory + '/uid-probe.c') +
      '\nchown 0:0 ' + quote(library) + '\nchmod 755 ' + quote(library), 120000);
    proof.uidObserverSourceSha256 = hash(uidProbe);
    const secrets = process.platform === 'win32' ? new Secrets(machines) : undefined;
    if (secrets) await secrets.save(vmId, { name: 'mesh-key', value: secret });
    proof.secretsVerified = Boolean(secrets);
    workspaces = new Workspaces(machines, { secrets }); core = new ProjectIdentities(machines); scopes = new ProjectRunScopes(machines);
    preparation = new ProjectTerminals(machines, workspaces);
    const guest = '/srv/projects/mesh-smoke-' + invocation;
    /**
     * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
     * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
     * 输入 / Inputs: scope: string。
     * 结果：返回分支计算值（`({ MESH_SCOPE: scope, LD_PRELOAD: library, SAKURA_MESH_UID_TEST: marker, SAKURA_…`）。
     * Result: Return the branch-computed value (`({ MESH_SCOPE: scope, LD_PRELOAD: library, SAKURA_MESH_UID_TEST: marker, SAKURA_…`).
     */
    const environment = (scope: string) => ({ MESH_SCOPE: scope, LD_PRELOAD: library, SAKURA_MESH_UID_TEST: marker, SAKURA_MESH_FRAME_ENV: frameEnv });
    await workspaces.save(vmId, { directory: guest + '/shared', environment: environment('host') }); projects.push('default');
    const alpha = (await workspaces.projects.create(vmId, 'Private A', async () => { await workspaces!.save(vmId, {
      directory: guest + "/private 'alpha space", networkIsolation: 'private', environment: environment('alpha'),
      ...(secrets ? { secrets: { TOKEN: 'mesh-key' } } : {}),
    }); })).active; projects.push(alpha); proof.alpha = alpha;
    const beta = (await workspaces.projects.create(vmId, 'Private B', async () => { await workspaces!.save(vmId, {
      directory: guest + '/private-beta', networkIsolation: 'private', environment: environment('beta'),
    }); })).active; projects.push(beta); proof.beta = beta;
    const migrations = new ProjectDirectoryMigrations(machines, workspaces);
    for (const projectId of projects) {
      const project = await config(projectId);
      assert.ok(project.directory.startsWith(guest + '/'));
      await root('mkdir -p ' + quote(project.directory));
      await within(projectId, async () => {
        const preview = await migrations.preview(vmId); assert.ok(preview.plan);
        proof.events.push({ op: 'reviewed-own-fixture-migration', projectId, plan: preview.plan });
        await persist();
        const applied = await migrations.apply(vmId, { action: 'apply', version: 1,
          planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
        assert.equal(applied.plan?.state, 'applied'); assert.ok(applied.plan?.activatedIdentity);
        identities.set(projectId, applied.plan.activatedIdentity);
      });
    }
    assert.equal(new Set([...identities.values()].map(v => v.uid)).size, 3);
    assert.equal(new Set([...identities.values()].map(v => v.home)).size, 3);
    mesh = create(); await mesh.init(); bridges = new ProjectNetworkBridges(machines);
    const cold = await readonlyOperation(() => status(alpha)); assert.equal(cold.namespacePresent, false);
    const taskCount = proof.taskRuns.length; const readonly = await readonlyOperation(() => status(alpha));
    assert.equal(readonly.envoyUsable, null); assert.equal(proof.taskRuns.length, taskCount);
    const checked = await within(alpha, () => mesh!.action(vmId, { mode: 'start' }, 'check'));
    assert.equal(checked.namespacePresent, true, 'Explicit first-private check prepares the original namespace');
    if (checked.envoyUsable === false) {
      assert.equal(distro, 'alpine'); assert.match(proof.taskRuns.at(-1)?.result.stderr || '', /symbol not found/);
      await action(alpha, 'save'); await assert.rejects(action(alpha, 'start'), /symbol not found|Envoy|版本/);
      const refused = await status(alpha); assert.equal(refused.sidecarRunning, false); assert.equal(refused.ready, false);
      assert.equal((await store()).runs.length, 0); assert.equal((await store()).tasks.length, 0);
      proof.dependencyRefusalPassed = true; proof.compatibility = 'incompatible pinned release; actual Envoy proxy traffic unverified';
      proof.passed = true; return;
    }
    assert.equal(checked.envoyUsable, true); assert.ok(checked.version?.includes(envoyVersion));
    for (const [projectId, scope] of [['default', 'host'], [alpha, 'alpha'], [beta, 'beta']]) {
      await action(projectId, 'save'); await action(projectId, 'start'); await proveService(projectId); await startFixture(projectId, 'upstream', scope);
    }
    const hostBody = await response('default', 'host'), alphaBody = await response(alpha, 'alpha'), betaBody = await response(beta, 'beta');
    assert.notEqual(alphaBody.namespace, hostBody.namespace); assert.notEqual(alphaBody.namespace, betaBody.namespace);
    const originalAlpha = active.get(alpha)!, originalBeta = active.get(beta)!;
    assert.notEqual(originalAlpha.row.execution.identity.uid, originalBeta.row.execution.identity.uid);
    const blocked = await client(alpha, 'exec /usr/bin/python3 -I -S -c ' + quote("import socket\nsocket.create_connection(('203.0.113.1',80),1)"));
    assert.notEqual(blocked.code, 0);
    await root('test "$(ip -n sk-' + alpha + ' -o -4 route show | wc -l)" -eq 0\n' +
      'test "$(ip -n sk-' + alpha + ' -o -6 route show | wc -l)" -eq 0');
    const bridgePort = await freePort(); await bridges.open(vmId, await config(alpha), policy.listenPort, bridgePort);
    const bridged = await fetch('http://127.0.0.1:' + bridgePort, { signal: AbortSignal.timeout(15000) });
    assert.equal((await bridged.json()).scope, 'alpha'); await bridges.stop(vmId, alpha);
    await within(alpha, async () => {
      const project = await workspaces!.config(vmId);
      await assert.rejects(workspaces!.save(vmId, { ...project, directory: guest + '/moved' }), /停止.*边车/);
      await assert.rejects(workspaces!.save(vmId, { ...project, networkIsolation: 'host' }), /停止.*边车/);
    });
    await assert.rejects(mesh.configure(vmId, false, async () => { enabled = false; }), /停止所有项目/);
    const beforeReload = { tasks: proof.taskRuns.length, row: structuredClone(originalAlpha.row) };
    await mesh.close(); mesh = create(); await readonlyOperation(async () => { await mesh!.init(); await proveService(alpha); });
    assert.equal(proof.taskRuns.length, beforeReload.tasks); assert.deepEqual(active.get(alpha)!.row, beforeReload.row);
    const pausedLive = machines.live.get(vmId); await machines.suspend(vmId);
    assert.equal((await status(alpha)).sidecarStateKnown, false);
    await assert.rejects(action(alpha, 'save'), /恢复实例/);
    await assert.rejects(action(alpha, 'stop'), (error: any) => error.status === 503);
    await assert.rejects(mesh.configure(vmId, false, async () => { enabled = false; }), /恢复实例/);
    await machines.resume(vmId); assert.equal(machines.live.get(vmId), pausedLive);
    await proveService(alpha); assert.equal(active.get(alpha)!.row.execution.record.runId, originalAlpha.row.execution.record.runId);
    // Changed bytes do not authorize deletion. Public stop retires the original
    // run but retains the exact config receipt on 503 until its reviewed bytes
    // are restored through the fixed administrator fixture.
    const changed = active.get(alpha)!, cfg = changed.row.config;
    const backup = await control({ op: 'config-read', projectId: alpha, runId: changed.row.plan.runId, config: cfg });
    await control({ op: 'tamper', projectId: alpha, runId: changed.row.plan.runId, config: cfg, body: backup.body });
    assert.equal((await status(alpha)).bindingValid, false);
    try {
      await assert.rejects(action(alpha, 'stop'), (error: any) => error.status === 503);
      const retained = (await store()).runs.find((v: any) => v.id === changed.row.id); assert.ok(retained);
      assert.deepEqual(retained.config, cfg); await proveService(beta); await response(beta, 'beta');
    } finally {
      await control({ op: 'restore', projectId: alpha, runId: changed.row.plan.runId, config: cfg, body: backup.body });
    }
    await action(alpha, 'stop'); await proveStopped(changed);
    await startFixture(alpha, 'legacy', 'alpha');
    await response(alpha, 'alpha');
    const legacyView = await status(alpha); assert.equal(legacyView.bindingValid, false); assert.equal(legacyView.sidecarRunning, true);
    const legacyOwner = fixtures.get('legacy:' + alpha)!.owner;
    await assert.rejects(action(alpha, 'start'), /旧版|核对|手动|归属/); await assert.rejects(action(alpha, 'stop'), /旧版|核对|手动|归属/);
    assert.equal((await status(alpha)).sidecarRunning, true, 'Public stop must preserve legacy root evidence');
    assert.ok(legacyOwner.pid); await stopFixture('legacy:' + alpha); await proveService(beta);
    await action(alpha, 'start'); const detached = await proveService(alpha);
    await observe(detached.row.execution.identity, detached.row.execution.run, { op: 'terminate-envoy',
      binary: detached.row.binary, config: detached.row.config, target: { pid: detached.envoy.pid, ticks: detached.envoy.ticks } });
    const deadline = Date.now() + 15000;
    let surviving: any;
    do { surviving = await observe(detached.row.execution.identity, detached.row.execution.run, {
      binary: detached.row.binary, children: [detached.child] }); if (!surviving.members.some((v: any) => v.pid === detached.envoy.pid)) break; await delay(50); }
    while (Date.now() < deadline);
    assert.ok(!surviving.members.some((v: any) => v.pid === detached.envoy.pid)); assert.equal(surviving.children[0].sameProcessAlive, true);
    assert.equal((await status(alpha)).bindingValid, false); await action(alpha, 'stop'); await proveStopped(detached);
    await proveService(beta); assert.equal(active.get(beta)!.row.execution.record.runId, originalBeta.row.execution.record.runId);
    const abort = new AbortController(), originalCancelExec = machines.exec.bind(machines);
    let cancelled: any;
    machines.exec = /**
     * 中文功能：执行当前模块的真实客户机观察或配置步骤并检查其条件；下述断言摘录明确本函数证明的边界。
     * English: Perform this module's real guest observation/configuration step and check its conditions; assertion excerpts below identify the established boundaries.
     * 输入 / Inputs: args: Parameters<typeof originalCancelExec>。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 状态影响 / State effects: `native`, `observation`, `report`, `cancelled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `originalCancelExec`, `args[1].match`, `JSON.parse`, `Buffer.from(match[1], 'base64').toString`.
     * 检查边界 / Checked boundaries: `assert.ok(row?.execution.sha256)`; `assert.equal(record.phase, 'running')`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    async (...args: Parameters<typeof originalCancelExec>) => {
      const result = await originalCancelExec(...args), match = args[1].match(/# SAKURA_PROJECT_SERVICE_REQUEST=([A-Za-z0-9+/=]+)/);
      if (match) {
        const request = JSON.parse(Buffer.from(match[1], 'base64').toString());
        if (request.namespace === 'mesh' && request.projectId === alpha && request.op === 'commit') {
          const row = (await store()).runs.find((v: any) => v.projectId === alpha); assert.ok(row?.execution.sha256);
          const record = JSON.parse(result.stdout).record; assert.equal(record.phase, 'running');
          const deadline = Date.now() + 30000; let native: ProjectIdentityRun | undefined, observation: any, report: any;
          while (Date.now() < deadline) {
            try {
              native = await core.runReadonly(vmId, row.execution.identity, record.runId);
              if (native.phase === 'active') {
                observation = await observe(row.execution.identity, native, { binary: row.binary, config: row.config });
                report = observation.reports.find((v: any) => v.operation === 'service');
                if (report) break;
              }
            } catch (error) { proof.events.push({ op: 'cancel-wait-native-issue', error: scrub(error) }); }
            await delay(50);
          }
          assert.ok(report && native); const envoy = observation.members.find((v: any) => v.pid === report.pid); assert.ok(envoy);
          assertUid(envoy, row.execution.identity, native);
          cancelled = { row: { ...structuredClone(row), execution: { ...row.execution, record, run: native } },
            observation, child: report.child, envoy }; active.set(alpha, cancelled);
          abort.abort();
        }
      }
      return result;
    };
    restoring = /**
     * 中文功能：协调本模块中下述具体调用与结果，推进自有真实环境验收或其诊断观察。
     * English: Coordinate the concrete calls/results below to advance owned real-environment acceptance or diagnostic observations.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `machines!.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    () => { machines!.exec = originalCancelExec; };
    try { await assert.rejects(action(alpha, 'start', abort.signal)); }
    finally { restoring(); restoring = undefined; }
    assert.ok(cancelled, 'Cancellation must occur after real UID Envoy launch');
    await proveStopped(cancelled); await proveService(beta); await response(beta, 'beta');
    await root('ip -n sk-' + alpha + ' route add blackhole 203.0.113.0/24');
    try { await assert.rejects(action(alpha, 'start'), /路由/); }
    finally { await root('ip -n sk-' + alpha + ' route del blackhole 203.0.113.0/24'); }
    assert.equal((await status(alpha)).sidecarRunning, false);
    for (const projectId of projects) { await stop(projectId); await stopFixture('upstream:' + projectId); }
    await mesh.configure(vmId, false, async () => { enabled = false; });
    await assert.rejects(action(alpha, 'start'), /已禁用/); await mesh.configure(vmId, true, async () => { enabled = true; });
    // Leave one known UID service across a real cold boot. Status never adopts
    // the old ticket; explicit public stop retires only its original boot.
    await action(alpha, 'start'); const previousBoot = await proveService(alpha);
    const taskBeforeBoot = proof.taskRuns.length; await root('sync'); await machines.stop(vmId, true); await boot();
    assert.notEqual(bootId, previousBoot.row.execution.run.bootId);
    for (const projectId of projects) {
      const rebooted = await readonlyOperation(() => status(projectId)); assert.equal(rebooted.bindingValid, false); assert.ok(rebooted.policy);
    }
    assert.equal(proof.taskRuns.length, taskBeforeBoot);
    await action(alpha, 'stop'); await proveStopped(previousBoot, true);
    await action(alpha, 'start'); const recovered = await proveService(alpha);
    assert.equal(recovered.row.execution.identity.identityId, identities.get(alpha)!.identityId);
    assert.equal(recovered.row.execution.identity.home, identities.get(alpha)!.home);
    await startFixture(alpha, 'upstream', 'alpha'); await response(alpha, 'alpha'); await stop(alpha); await stopFixture('upstream:' + alpha);
    assert.equal((await store()).tasks.length, 0); assert.equal((await store()).runs.length, 0);
    assert.ok(!JSON.stringify(await status(alpha)).includes(secret));
    proof.proxyTrafficVerified = true; proof.passed = true;
  } catch (error) { primary = error; proof.failure = describeError(error); }
  finally {
    restoring?.();
    if (machines && vmId && machines.state(vmId) === 'paused') await clean('resume-original-live', () => machines!.resume(vmId));
    // Each cleanup is independent. Guest domains and receipts are checked while
    // the original machine is still available; disks/evidence are never removed.
    if (machines && mesh && vmId && machines.state(vmId) === 'running')
      for (const projectId of projects) await clean('public-mesh-stop:' + projectId, () => stop(projectId));
    if (machines && vmId && machines.state(vmId) === 'running')
      for (const key of [...fixtures.keys()]) await clean('fixed-root-fixture:' + key, () => stopFixture(key));
    await clean('loopback-bridges', async () => bridges?.close());
    await clean('mesh-controller', async () => mesh?.close());
    await clean('finite-observation-monitors', async () => { await Promise.all(taskMonitors); });
    await clean('project-preparation', async () => preparation?.close());
    await clean('workspaces', async () => workspaces?.close());
    await clean('owned-machine-stop', async () => { if (machines && vmId && machines.live.has(vmId)) await machines.stop(vmId, true); });
    await clean('machines-controller', async () => machines?.close());
    await clean('actual-owned-qemu-child-close', async () => {
      for (const child of children.keys()) child.kill();
      const bounded = AbortSignal.timeout(10000);
      await Promise.race([Promise.all(children.values()), new Promise<never>((_, fail) => {
        bounded.addEventListener('abort', () => fail(new Error('Owned QEMU close event not received')), { once: true });
      })]);
      for (const child of proof.qemuExecutions) {
        assert.equal(child.close, true); assert.ok(child.exit); assert.equal(child.stdoutClosed, true); assert.equal(child.stderrClosed, true);
        assert.equal(child.settled, true);
      }
      assert.ok(proof.qemuExecutions.length); proof.childCloseVerified = true;
    });
    await clean('runtime', async () => engine?.runtime.close());
    await clean('owned-qemu-inventory', async () => {
      if (!disk) return;
      const remaining = inventory(disk); proof.inventories.push({ at: 'after-independent-cleanup', disk, processes: remaining });
      assert.deepEqual(remaining, []); proof.diskAfter = await pin(disk); assert.deepEqual(await pin(basePin.path), basePin);
    });
    await clean('unchanged-cache-and-source', async () => {
      assert.deepEqual(await pin(cachePin.path), cachePin); assert.deepEqual(await sourcePins(), initialSources);
    });
    restoreAudit?.(); restoreInstall?.();
    if (proof.cleanupErrors.length) proof.passed = false;
    proof.completedAt = new Date().toISOString(); await persist(); await queue;
    console.log(JSON.stringify({ passed: proof.passed, proxyTrafficVerified: proof.proxyTrafficVerified,
      compatibility: proof.compatibility || 'verified real pinned Envoy', childCloseVerified: proof.childCloseVerified,
      retainedFixture: directory, proof: proofFile, cleanupErrors: proof.cleanupErrors.length }, null, 2));
    // The Alpine dependency-refusal path returns early. Cleanup failures must
    // still escape this finally and produce a failing process exit.
    if (proof.cleanupErrors.length) throw new AggregateError([
      ...(primary ? [new Error(scrub(primary))] : []),
      ...proof.cleanupErrors.map((item: any) => new Error(item.component + ': ' + JSON.stringify(item.error))),
    ], 'Service-mesh UID smoke cleanup failed; owned evidence retained at ' + directory);
  }
  if (primary || proof.cleanupErrors.length) throw new AggregateError([
    ...(primary ? [new Error(scrub(primary))] : []),
    ...proof.cleanupErrors.map((item: any) => new Error(item.component + ': ' + JSON.stringify(item.error))),
  ], 'Service-mesh UID smoke failed; owned disk, exact receipts and evidence retained at ' + directory);
}
