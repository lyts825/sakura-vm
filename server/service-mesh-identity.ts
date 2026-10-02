import { createHash } from 'node:crypto';
import { z } from 'zod';
import { quote } from './files.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentity, type ProjectIdentityRun } from './project-identity.ts';
import type { ProjectMeshRecord } from './project-service-scope.ts';
import type { Project } from './workspaces.ts';
import { reverseTunnelListenerSchema, type ReverseTunnelListener } from './reverse-tunnel-transport.ts';

const decimal = z.string().regex(/^[1-9][0-9]*$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const meshBinarySchema = z.object({ path: z.string().regex(/^\/(usr\/(local\/)?bin|bin)\/envoy$/),
  device: z.string().regex(/^(0|[1-9][0-9]*)$/), inode: decimal, size: z.number().int().min(1), mtimeNs: decimal }).strict();
export type MeshBinary = z.infer<typeof meshBinarySchema>;
export const meshConfigSchema = z.object({ version: z.literal(1),
  path: z.string().regex(/^\/etc\/sakura\/mesh-uid\/(default|[a-f0-9]{16})\/[a-f0-9-]{36}\.json$/),
  device: z.string().regex(/^(0|[1-9][0-9]*)$/), inode: decimal, sha256: digest,
  bytes: z.number().int().min(1).max(16384), gid: z.number().int().min(20000).max(59999) }).strict();
export type MeshConfig = z.infer<typeof meshConfigSchema>;
export const meshHostStatusSchema = z.object({ bootId: z.uuid(), pythonInstalled: z.boolean(), tmuxInstalled: z.boolean(),
  envoy: meshBinarySchema.nullable(), directoryPresent: z.boolean(), namespacePresent: z.boolean(),
  legacyRunning: z.boolean(), legacyProcesses: z.array(z.number().int().min(2)).max(32768), legacyConfigPresent: z.boolean() }).strict();
export type MeshHostStatus = z.infer<typeof meshHostStatusSchema>;
export const meshConfigReplySchema = z.object({ present: z.boolean(), config: meshConfigSchema.nullable() }).strict();
export const meshConfigCleanSchema = z.object({ cleaned: z.literal(true) }).strict();
export const meshProcessReplySchema = z.object({ ready: z.literal(true) }).strict();
type Ports = { listenPort: number; upstreamPort: number };
export type MeshConfigPlan = { projectId: string; identityId: string; uid: number; gid: number; runId: string;
  bootId: string; path: string; sha256: string; bytes: number; listenPort: number; upstreamPort: number };
export function meshConfigPlan(identity: ProjectIdentity, record: ProjectMeshRecord, source: string, ports: Ports): MeshConfigPlan {
  identity = projectIdentitySchema.parse(identity);
  if (record.projectId !== identity.projectId || identity.phase !== 'active') throw new Error('Mesh identity mismatch');
  const bytes = Buffer.from(source); if (bytes.length < 1 || bytes.length > 16384) throw new Error('Fixed mesh config bound');
  return { projectId: identity.projectId, identityId: identity.identityId, uid: identity.uid, gid: identity.gid,
    runId: record.runId, bootId: record.bootId, path: `/etc/sakura/mesh-uid/${identity.projectId}/${record.runId}.json`,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    listenPort: ports.listenPort, upstreamPort: ports.upstreamPort };
}
export function meshInspectInput(project: Project) {
  return meshControlInput({ op: 'inspect', projectId: projectIdSchema.parse(project._workspace || 'default'),
    directory: project.directory, networkIsolation: project.networkIsolation || 'host' });
}
export function meshConfigInput(op: 'publish' | 'config' | 'cleanup', plan: MeshConfigPlan, config?: MeshConfig | null, source?: string) {
  return meshControlInput({ op, ...plan, config: config || null }, source === undefined ? undefined : Buffer.from(source));
}
export function meshProcessInput(plan: MeshConfigPlan, config: MeshConfig, binary: MeshBinary,
  identity: ProjectIdentity, run: ProjectIdentityRun, listener: ReverseTunnelListener) {
  return meshControlInput({ op: 'process', ...plan, config: meshConfigSchema.parse(config), binary: meshBinarySchema.parse(binary),
    identity: projectIdentitySchema.parse(identity), run: projectIdentityRunSchema.parse(run), listener: reverseTunnelListenerSchema.parse(listener) });
}
function meshControlInput(metadata: object, body?: Buffer) {
  const encoded = Buffer.from(JSON.stringify(metadata)); if (encoded.length > 8192 || body && body.length > 16384) throw new Error('Mesh control frame bound');
  const input = Buffer.alloc(12 + encoded.length + (body?.length || 0)); input.write('SKMESH01'); input.writeUInt32LE(encoded.length, 8);
  encoded.copy(input, 12); body?.copy(input, 12 + encoded.length); return input;
}
export function meshEnvoyExecution(binary: MeshBinary, config?: MeshConfig, validate = false) {
  binary = meshBinarySchema.parse(binary); if (config) config = meshConfigSchema.parse(config);
  const argv = config ? [binary.path, ...(validate ? ['--mode', 'validate'] : []), '-c', config.path,
    '--disable-hot-restart', '--concurrency', '1', '--log-level', 'warning'] : [binary.path, '--version'];
  const data = { binary, config: config || null, argv };
  const source = `import os,stat,hashlib,json
data=json.loads(${JSON.stringify(JSON.stringify(data))})
binary=data['binary'];info=os.stat(binary['path'])
assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
assert str(info.st_dev)==binary['device'] and str(info.st_ino)==binary['inode'] and info.st_size==binary['size'] and str(info.st_mtime_ns)==binary['mtimeNs']
config=data['config']
if config:
 descriptor=os.open(config['path'],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(descriptor)
  assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==os.getgid() and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o440
  assert str(info.st_dev)==config['device'] and str(info.st_ino)==config['inode'] and info.st_size==config['bytes']
  body=b''
  while len(body)<=16384:
   part=os.read(descriptor,4096)
   if not part:break
   body+=part
  assert len(body)==config['bytes'] and hashlib.sha256(body).hexdigest()==config['sha256']
 finally:os.close(descriptor)
os.execv(binary['path'],data['argv'])
`;
  return 'exec /usr/bin/python3 -I -S -c ' + quote(source);
}

// This root helper only handles bounded inert metadata, fixed bootstrap JSON and
// kernel ownership. It never runs Envoy, opens project hooks or exports project env.
const helper = `import os,stat,json,hashlib,struct,re,tempfile,subprocess,glob,fcntl
def refuse():raise ValueError('original mesh control identity changed')
def exact(size):
 data=b''
 while len(data)<size:
  part=os.read(0,size-len(data))
  if not part:refuse()
  data+=part
 return data
header=exact(12)
if header[:8]!=b'SKMESH01':refuse()
size=struct.unpack('<I',header[8:])[0]
if not 1<=size<=8192:refuse()
request=json.loads(exact(size));op=request['op'];boot=open('/proc/sys/kernel/random/boot_id').read().strip()
project=request['projectId']
if not isinstance(project,str) or not re.fullmatch(r'default|[a-f0-9]{16}',project):refuse()
def trusted(path,create=False,gid=0,mode=0o755):
 if create:
  try:os.mkdir(path,mode);os.chown(path,0,gid);os.chmod(path,mode)
  except FileExistsError:pass
 info=os.lstat(path)
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or gid and info.st_gid!=gid:refuse()
 return info
def program(paths):
 for candidate in paths:
  if not os.path.lexists(candidate):continue
  path=os.path.realpath(candidate);parent=os.path.dirname(path)
  while parent!='/':trusted(parent);parent=os.path.dirname(parent)
  info=os.lstat(path)
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or not info.st_mode&0o111:refuse()
  return {'path':path,'device':str(info.st_dev),'inode':str(info.st_ino),'size':info.st_size,'mtimeNs':str(info.st_mtime_ns)}
 return None
def bounded(path,limit):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(fd,min(4096,limit+1-len(data)))
   if not part:return data
   data+=part
  refuse()
 finally:os.close(fd)
def inspect():
 envoy=program(['/usr/local/bin/envoy','/usr/bin/envoy','/bin/envoy']);tmux=program(['/usr/bin/tmux','/bin/tmux'])
 old='sakura-mesh-'+project;path='/etc/sakura/mesh/'+project+'.json';pids=[]
 processes=glob.glob('/proc/[0-9]*')
 if len(processes)>32768:refuse()
 for process in processes:
  try:
   argv=bounded(process+'/cmdline',16384).rstrip(b'\\0').split(b'\\0')
   if any(argv[index] in [b'-c',b'--config-path'] and argv[index+1]==path.encode() for index in range(len(argv)-1)):pids.append(int(process.rsplit('/',1)[1]))
  except (FileNotFoundError,ProcessLookupError):pass
 session=False
 if tmux:
  result=subprocess.run([tmux['path'],'has-session','-t','='+old],capture_output=True,text=True,timeout=5)
  session=result.returncode==0
  if result.returncode and not any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']):refuse()
 try:directory=stat.S_ISDIR(os.lstat(request['directory']).st_mode)
 except FileNotFoundError:directory=False
 namespace=True
 if request['networkIsolation']=='private':
  try:
   trusted('/run');trusted('/run/netns');fd=os.open('/run/netns/sk-'+project,os.O_RDONLY|os.O_CLOEXEC)
   try:namespace=fcntl.ioctl(fd,0xb703)==0x40000000 and os.fstat(fd).st_uid==0
   finally:os.close(fd)
  except FileNotFoundError:namespace=False
 print(json.dumps({'bootId':boot,'pythonInstalled':True,'tmuxInstalled':tmux is not None,'envoy':envoy,
  'directoryPresent':directory,'namespacePresent':namespace,'legacyRunning':session or bool(pids),'legacyProcesses':pids,'legacyConfigPresent':os.path.lexists(path)}))
if op=='inspect':
 if os.read(0,1):refuse()
 inspect();raise SystemExit
for name in ['runId','bootId','identityId']:
 if not isinstance(request[name],str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',request[name]):refuse()
if not isinstance(request['gid'],int) or request['gid']!=request['uid'] or not 20000<=request['gid']<=59999:refuse()
if not re.fullmatch(r'[a-f0-9]{64}',request['sha256']) or not 1<=request['bytes']<=16384:refuse()
folder='/etc/sakura/mesh-uid/'+project;path=folder+'/'+request['runId']+'.json';receipt=folder+'/'+request['runId']+'.owner.json'
if request['path']!=path:refuse()
keys=['projectId','identityId','uid','gid','runId','bootId','path','sha256','bytes','listenPort','upstreamPort']
base={key:request[key] for key in keys}
def parents(create=False):
 trusted('/etc');trusted('/etc/sakura',create);trusted('/etc/sakura/mesh-uid',create)
 trusted(folder,create,request['gid'],0o750)
def owner():
 try:fd=os.open(receipt,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 except FileNotFoundError:return None
 try:
  info=os.fstat(fd)
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>8192:refuse()
  value=json.loads(os.read(fd,8193))
  if any(value.get(key)!=base[key] for key in keys):refuse()
  return value
 finally:os.close(fd)
def save_owner(value):
 fd,temporary=tempfile.mkstemp(dir=folder,prefix='.owner-')
 try:
  with os.fdopen(fd,'w') as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())
  os.replace(temporary,receipt);directory=os.open(folder,os.O_RDONLY|os.O_DIRECTORY);os.fsync(directory);os.close(directory)
 finally:
  if os.path.lexists(temporary):os.unlink(temporary)
def config(value):
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(fd);proof=value['config']
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=request['gid'] or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o440:refuse()
  if not proof or str(info.st_dev)!=proof['device'] or str(info.st_ino)!=proof['inode'] or info.st_size!=request['bytes']:refuse()
  body=os.read(fd,16385)
  if len(body)!=request['bytes'] or hashlib.sha256(body).hexdigest()!=request['sha256']:refuse()
  if request.get('config') is not None and request['config']!=proof:refuse()
  return proof
 finally:os.close(fd)
if op=='publish':
 if boot!=request['bootId']:refuse()
 body=exact(request['bytes'])
 if os.read(0,1) or hashlib.sha256(body).hexdigest()!=request['sha256']:refuse()
 port=request['listenPort'];upstream=request['upstreamPort']
 if type(port)!=int or type(upstream)!=int or not 1024<=port<=65535 or not 1024<=upstream<=65535 or port==upstream:refuse()
 expected={'static_resources':{'listeners':[{'name':'sakura_mesh_listener','address':{'socket_address':{'address':'127.0.0.1','port_value':port}},'filter_chains':[{'filters':[{'name':'envoy.filters.network.tcp_proxy','typed_config':{'@type':'type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy','stat_prefix':'sakura_mesh','cluster':'sakura_mesh_upstream'}}]}]}],'clusters':[{'name':'sakura_mesh_upstream','connect_timeout':'1s','type':'STATIC','load_assignment':{'cluster_name':'sakura_mesh_upstream','endpoints':[{'lb_endpoints':[{'endpoint':{'address':{'socket_address':{'address':'127.0.0.1','port_value':upstream}}}}]}]}}]}}
 if json.loads(body)!=expected:refuse()
 parents(True)
 if os.path.lexists(receipt) or os.path.lexists(path):refuse()
 save_owner(dict(base,phase='intent',config=None))
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o440)
 try:
  os.fchown(fd,0,request['gid']);os.fchmod(fd,0o440);info=os.fstat(fd)
  proof={'version':1,'path':path,'device':str(info.st_dev),'inode':str(info.st_ino),'sha256':request['sha256'],'bytes':request['bytes'],'gid':request['gid']}
  save_owner(dict(base,phase='writing',config=proof));offset=0
  while offset<len(body):offset+=os.write(fd,body[offset:])
  os.fsync(fd)
 finally:os.close(fd)
 save_owner(dict(base,phase='ready',config=proof));config(owner())
 if open('/proc/sys/kernel/random/boot_id').read().strip()!=boot:refuse()
 print(json.dumps({'present':True,'config':proof}));raise SystemExit
if os.read(0,1):refuse()
if op=='cleanup':
 if os.path.lexists('/sys/fs/cgroup/sakura-service-'+request['runId']):refuse()
 paths=glob.glob('/proc/[0-9]*')
 if len(paths)>32768:refuse()
 for process in paths:
  try:
   if path.encode() in bounded(process+'/cmdline',16384).rstrip(b'\\0').split(b'\\0'):refuse()
  except (FileNotFoundError,ProcessLookupError):pass
try:parents()
except FileNotFoundError:
 if op=='cleanup':print(json.dumps({'cleaned':True}));raise SystemExit
 print(json.dumps({'present':False,'config':None}));raise SystemExit
value=owner()
if value is None:
 if os.path.lexists(path):refuse()
 if op=='cleanup':print(json.dumps({'cleaned':True}));raise SystemExit
 print(json.dumps({'present':False,'config':None}));raise SystemExit
if op=='cleanup':
 if os.path.lexists(path):config(value);os.unlink(path)
 os.unlink(receipt);directory=os.open(folder,os.O_RDONLY|os.O_DIRECTORY);os.fsync(directory);os.close(directory)
 print(json.dumps({'cleaned':True}));raise SystemExit
proof=config(value)
if op=='config':
 if value['phase']!='ready':refuse()
 print(json.dumps({'present':True,'config':proof}));raise SystemExit
if op!='process' or value['phase']!='ready':refuse()
identity=request['identity'];run=request['run'];listener=request['listener'];binary=request['binary']
if boot!=run['bootId'] or run['runId']!=request['runId'] or run['projectId']!=project or identity['identityId']!=request['identityId'] or identity['uid']!=request['uid'] or identity['gid']!=request['gid']:refuse()
group='/sys/fs/cgroup/'+run['cgroupName'];info=os.lstat(group)
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or str(info.st_dev)!=run['cgroupDevice'] or str(info.st_ino)!=run['cgroupInode']:refuse()
process='/proc/'+str(listener['pid']);before=bounded(process+'/stat',4096).rsplit(b')',1)[1].split()
membership=bounded(process+'/cgroup',4096).decode().strip()
if before[19].decode()!=listener['startTicks'] or before[0] in [b'Z',b'X',b'x'] or membership!='0::/'+run['cgroupName'] and not membership.startswith('0::/'+run['cgroupName']+'/'):refuse()
status=dict(line.split(':',1) for line in bounded(process+'/status',65536).decode().splitlines() if ':' in line)
if status.get('Uid','').split()!=[str(identity['uid'])]*4 or status.get('Gid','').split()!=[str(identity['gid'])]*4:refuse()
if status.get('NoNewPrivs','').strip()!='1' or any(int(status.get(name,'1'),16) for name in ['CapEff','CapPrm','CapInh','CapBnd','CapAmb']):refuse()
argv=bounded(process+'/cmdline',16384).rstrip(b'\\0').split(b'\\0')
expected=[binary['path'],'-c',path,'--disable-hot-restart','--concurrency','1','--log-level','warning']
if argv!=[part.encode() for part in expected]:refuse()
info=os.stat(process+'/exe')
if str(info.st_dev)!=binary['device'] or str(info.st_ino)!=binary['inode']:refuse()
info=os.stat(process+'/cwd')
if str(info.st_dev)!=identity['directoryDevice'] or str(info.st_ino)!=identity['directoryInode']:refuse()
info=os.stat(process+'/ns/net')
if str(info.st_dev)!=run['networkDevice'] or str(info.st_ino)!=run['networkInode']:refuse()
sockets=set(os.readlink(process+'/fd/'+name) for name in os.listdir(process+'/fd'))
if 'socket:['+listener['socketInode']+']' not in sockets or listener['port']!=request['listenPort']:refuse()
after=bounded(process+'/stat',4096).rsplit(b')',1)[1].split();info=os.lstat(group)
if after[19]!=before[19] or after[0] in [b'Z',b'X',b'x'] or bounded(process+'/cgroup',4096).decode().strip()!=membership or str(info.st_dev)!=run['cgroupDevice'] or str(info.st_ino)!=run['cgroupInode'] or open('/proc/sys/kernel/random/boot_id').read().strip()!=boot:refuse()
config(owner());print(json.dumps({'ready':True}))
`;
export const meshControlCommand = 'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ' +
  '/bin/sh -ec ' + quote('cd /\nif [ ! -x /usr/bin/python3 ]; then echo "SAKURA_MESH_PYTHON_REQUIRED" >&2; exit 73; fi\nexec /usr/bin/python3 -I -S -c ' + quote(helper));
