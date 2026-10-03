import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from './project-identity.ts';
import { projectDesktopRecordSchema } from './project-service-scope.ts';
import { desktopAuthoritySource } from './desktop-project-authority.ts';

const decimal = z.string().regex(/^[1-9][0-9]*$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const nestedX11EndpointSchema = z.object({
  display: z.string().regex(/^:[0-9]{1,5}(?:\.0)?$/),
  xauthPath: z.string().min(1).max(1023).regex(/^\/[^\x00-\x1f]*$/),
  xauthDevice: decimal, xauthInode: decimal, xauthSha256: digest,
  socketPath: z.string().regex(/^\/tmp\/\.X11-unix\/X[0-9]{1,5}$/),
  socketDevice: decimal, socketInode: decimal, kernelInode: decimal,
  peerPid: z.number().int().min(2), peerCreated: decimal,
  peerImage: z.enum(['/usr/bin/Xwayland', '/usr/bin/kwin_wayland', '/usr/bin/kwin_wayland_wrapper']),
}).strict();
export const desktopEndpointSchema = z.object({
  plasmaPid: z.number().int().min(2), plasmaCreated: decimal, vncPid: z.number().int().min(2), vncCreated: decimal,
  runtimeDevice: decimal, runtimeInode: decimal, xauthDevice: decimal, xauthInode: decimal,
  xauthSha256: digest, readyDevice: decimal, readyInode: decimal,
  nestedX11: nestedX11EndpointSchema.optional(),
}).strict();
export const desktopControlProofSchema = z.object({ version: z.literal(1), identity: projectIdentitySchema,
  run: projectIdentityRunSchema.nullable(), record: projectDesktopRecordSchema, sha256: digest,
  runtime: z.string().max(1023), endpoint: desktopEndpointSchema.nullable(), build: digest,
}).strict().superRefine((proof, ctx) => {
  const { identity, record, run } = proof;
  if (identity.phase !== 'active' || identity.projectId !== record.projectId ||
      proof.runtime !== '/run/sakura-desktop-uid/' + identity.uid + '/' + record.runId || run &&
      (run.phase !== 'active' || run.mode !== 'inherit-current' || run.projectId !== identity.projectId ||
       run.registryId !== identity.registryId || run.identityId !== identity.identityId || run.revision !== identity.revision ||
       run.runId !== record.runId || run.bootId !== record.bootId || run.build !== proof.build ||
       run.cgroupName !== record.scopeName || run.cgroupInode !== record.inode))
    ctx.addIssue({ code: 'custom', message: 'Desktop adapter 原完整归属不符' });
});
export type DesktopControlProof = z.infer<typeof desktopControlProofSchema>;
export const desktopAuthoritySchema = desktopControlProofSchema.transform(({ build: _build, ...proof }) => proof);
export type DesktopAuthority = z.output<typeof desktopAuthoritySchema> & { run: NonNullable<DesktopControlProof['run']> };
const fixedEnvironment = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C';
const adapterStages = ['REQUEST', 'GUARD_IDENTITY', 'GUARD_RECORD', 'GUARD_NETWORK', 'GUARD_RUNTIME',
  'GUARD_FIREWALL', 'AUTHORITY', 'RUNTIME_CLEANUP', 'STREAM_NETWORK', 'STREAM_RELAY'] as const;
const adapterReasons = ['CHECK_REJECTED', 'NOT_READY_CREDENTIAL', 'NOT_READY_PROCESS', 'NOT_READY_NESTED_X11',
  'OBJECT_ABSENT', 'PERMISSION_DENIED', 'SYMLINK_REFUSED', 'OBJECT_BUSY', 'IO_FAILED', 'DATA_INVALID', 'VALIDATION_REJECTED'] as const;
const adapterRefusalSchema = z.object({ ok: z.literal(false), code: z.enum(['DESKTOP_NOT_READY', 'DESKTOP_SCOPE_CHANGED']),
  stage: z.enum(adapterStages), reason: z.enum(adapterReasons), checkLine: z.number().int().min(0).max(8192) }).strict();

export const desktopAdapterSource = String.raw`import base64,ctypes,errno,fcntl,hashlib,json,os,pwd,re,select,signal,socket,stat,struct,subprocess,sys,tempfile,time
from pathlib import Path
adapter_stage='REQUEST'

def desktop_adapter_refusal(error,stage):
 # Publish only fixed classifications and a line in this trusted program.
 # Exception messages, filenames and the project environment never leave it.
 waiting={'SAKURA_DESKTOP_NOT_READY:credential':'NOT_READY_CREDENTIAL','SAKURA_DESKTOP_NOT_READY:process':'NOT_READY_PROCESS','SAKURA_DESKTOP_NOT_READY:nested-x11':'NOT_READY_NESTED_X11'}
 line=getattr(error,'desktop_check_line',0)
 if type(line) is not int or not 0<=line<=8192: line=0
 reason='CHECK_REJECTED' if line else 'VALIDATION_REJECTED'
 if isinstance(error,OSError):
  line=0; trace=error.__traceback__; frames=0
  while trace is not None and frames<64:
   code=trace.tb_frame.f_code
   if code.co_filename=='<string>' and code.co_name in ('secure_directory','retire_runtime','erase','guard','original_group_absent','invoke','stream','desktop_native','protected','desktop_process','desktop_authority','credential','desktop_nested_x11') and 0<trace.tb_lineno<=8192:
    line=trace.tb_lineno
   trace=trace.tb_next; frames+=1
  if trace is not None: line=0
  reason={errno.ENOENT:'OBJECT_ABSENT',errno.ESRCH:'OBJECT_ABSENT',errno.EACCES:'PERMISSION_DENIED',errno.EPERM:'PERMISSION_DENIED',errno.ELOOP:'SYMLINK_REFUSED',errno.EBUSY:'OBJECT_BUSY',errno.EAGAIN:'OBJECT_BUSY'}.get(error.errno,'IO_FAILED')
 else:
  reason=waiting.get(str(error),reason)
  if isinstance(error,(ValueError,KeyError,IndexError,TypeError)): reason='DATA_INVALID'
 retry=reason in waiting.values() and stage=='AUTHORITY'
 return {'ok':False,'code':'DESKTOP_NOT_READY' if retry else 'DESKTOP_SCOPE_CHANGED','stage':stage,'reason':reason,'checkLine':line}

def require(condition,message):
 if not condition:
  error=RuntimeError(message); error.desktop_check_line=sys._getframe(1).f_lineno; raise error
def secure_directory(path):
 current=Path('/')
 for part in Path(path).parts[1:]:
  current/=part; info=current.lstat()
  require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022,'Desktop adapter 目录不可信')
 return path
` + desktopAuthoritySource + String.raw`
def retire_runtime(proof,receipt):
 global adapter_stage
 adapter_stage='RUNTIME_CLEANUP'
 identity=proof['identity']; path=Path(proof['runtime'])
 secure_directory(path.parent)
 try: fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 except FileNotFoundError: return
 try:
  info=os.fstat(fd)
  require((str(info.st_dev),str(info.st_ino))==(receipt['runtimeDevice'],receipt['runtimeInode']), 'Desktop 原 runtime inode 改变，保留票据')
  if receipt['phase']=='creating' and info.st_uid==0 and info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o700:
   require(not os.listdir(fd),'Desktop 未交付 runtime 含不明内容，保留票据')
   parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
   try:
    current=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
    require((current.st_dev,current.st_ino)==(info.st_dev,info.st_ino),'Desktop 未交付 runtime 在退休前改变')
    os.rmdir(path.name,dir_fd=parent); os.fsync(parent)
   finally: os.close(parent)
   return
  require(info.st_uid==identity['uid'] and info.st_gid==identity['gid'],'Desktop 原 runtime UID 改变，保留票据')
  # User-controlled files are traversed only after the exact numeric UID drop.
  # No root metadata FD is inherited by this bounded, fixed cleanup worker.
  worker=os.fork()
  if worker==0:
   try:
    require(ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL,0,0,0)==0 and os.getppid()>1,'Desktop runtime 原清理进程退出')
    require(ctypes.CDLL(None,use_errno=True).prctl(38,1,0,0,0)==0,'Desktop runtime 无法禁止提权')
    os.setgroups([]); os.setresgid(identity['gid'],identity['gid'],identity['gid']); os.setresuid(identity['uid'],identity['uid'],identity['uid'])
    os.fchmod(fd,0o700); remaining=[4096]
    def erase(parent,depth):
     require(depth<=32,'Desktop runtime 深度超过清理上限')
     for name in os.listdir(parent):
      remaining[0]-=1; require(remaining[0]>=0,'Desktop runtime 条目超过清理上限')
      info=os.stat(name,dir_fd=parent,follow_symlinks=False)
      if stat.S_ISDIR(info.st_mode):
       child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
       try: os.fchmod(child,0o700); erase(child,depth+1)
       finally: os.close(child)
       os.rmdir(name,dir_fd=parent)
      else: os.unlink(name,dir_fd=parent)
    erase(fd,0); os._exit(0)
   except BaseException: os._exit(73)
  deadline=time.monotonic()+10
  while True:
   result,status=os.waitpid(worker,os.WNOHANG)
   if result:
    require(os.WIFEXITED(status) and os.WEXITSTATUS(status)==0,'Desktop 原 runtime 内容清理未确认，保留票据'); break
   if time.monotonic()>=deadline:
    os.kill(worker,signal.SIGKILL); os.waitpid(worker,0)
    raise RuntimeError('Desktop runtime 清理超时，保留原票据')
   time.sleep(.02)
  parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   info=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
   require((str(info.st_dev),str(info.st_ino))==(receipt['runtimeDevice'],receipt['runtimeInode']),'Desktop runtime 在退休前被替换')
   os.rmdir(path.name,dir_fd=parent); os.fsync(parent)
  finally: os.close(parent)
 finally: os.close(fd)

def guard(proof,op):
 global adapter_stage
 adapter_stage='GUARD_IDENTITY'
 identity,record=proof['identity'],proof['record']; core=desktop_native(proof['build'])
 require(record['name']=='desktop' and record['session']=='sakura-desktop-'+identity['projectId']
         and record['projectId']==identity['projectId'] and record['scopeName']=='sakura-service-'+record['runId']
         and re.fullmatch('[a-f0-9-]{36}',record['runId']) and re.fullmatch('[a-f0-9]{64}',proof['sha256'])
         and proof['runtime']=='/run/sakura-desktop-uid/'+str(identity['uid'])+'/'+record['runId'], 'Desktop guard 原身份不符')
 boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
 lock=core['initialize_readonly']()
 try:
  if op!='unguard':
   value=core['active'](identity['projectId'],{'expected':{key:identity[key] for key in ('registryId','identityId','revision')}},core['registry'](True))
   require(value==identity,'Desktop guard 原项目账户改变')
  if op!='unguard': require(boot==record['bootId'],'Desktop guard boot 改变')
 finally: os.close(lock)
 adapter_stage='GUARD_RECORD'
 root=Path('/run/sakura-project-desktop-guards'); path=root/(record['runId']+'.json')
 def original_group_absent():
  parent=core['directory_fd']('/sys/fs/cgroup'); os.close(parent)
  require(not os.path.lexists('/sys/fs/cgroup/'+record['scopeName']),'Desktop 原完整域仍存在，guard 保留')
 expected={'version':1,'identity':identity,'runId':record['runId'],'bootId':record['bootId'],
           'scopeName':record['scopeName'],'binding':record['binding'],'sha256':proof['sha256'],'build':proof['build']}
 if op=='guard':
  original_group_absent()
  try: core['make_directory'](str(root))
  except FileExistsError: pass
 else:
  try: secure_directory(root)
  except FileNotFoundError:
   require(op=='unguard','Desktop 原 guard 未登记'); original_group_absent()
   require(not os.path.lexists(proof['runtime']),'Desktop 原 runtime 票据缺失，拒绝接管残留目录')
   return {'guarded':False}
 receipt=core['json_read'](str(path),True)
 if receipt is not None:
  require(set(receipt)==set(expected)|{'networkDevice','networkInode','runtimeDevice','runtimeInode','phase'} and all(receipt[key]==value for key,value in expected.items()),
          'Desktop 原 guard receipt 已改变')
 if op=='guard': require(receipt is None,'Desktop guard 不允许重放')
 if op=='unguard': original_group_absent()
 if boot!=record['bootId']:
  require(op=='unguard' and receipt is None,'Desktop 旧 boot guard 尚有不明证明'); return {'guarded':False}
 adapter_stage='GUARD_NETWORK'
 namespace='sk-'+identity['projectId'] if identity['networkIsolation']=='private' else None
 if namespace:
  parent=core['directory_fd']('/run/netns')
  try:
   try: net=os.open(namespace,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
   except FileNotFoundError:
    require(op=='unguard' and receipt is not None,'Desktop 原网络 guard 未确认')
    retire_runtime(proof,receipt); core['durable_unlink'](str(path)); return {'guarded':False}
  finally: os.close(parent)
 else: net=os.open('/proc/1/ns/net',os.O_RDONLY|os.O_CLOEXEC)
 try:
  network=os.fstat(net); require(network.st_uid==0 and fcntl.ioctl(net,0xb703)==0x40000000,'Desktop guard 网络对象不符')
  if receipt is not None: require((str(network.st_dev),str(network.st_ino))==(receipt['networkDevice'],receipt['networkInode']),'Desktop 原 guard 网络 inode 改变')
  if proof['run'] is not None: require((str(network.st_dev),str(network.st_ino))==(proof['run']['networkDevice'],proof['run']['networkInode']),'Desktop guard native 网络票据不符')
  require(ctypes.CDLL(None,use_errno=True).setns(net,0x40000000)==0,'Desktop guard 无法进入原网络')
 finally: os.close(net)
 adapter_stage='GUARD_FIREWALL'
 chain='SDK_'+record['runId'].replace('-','')[:24]; comment='sakura-desktop:'+record['runId']
 program=core['tool']('iptables')
 def invoke(arguments,accept=False):
  result=subprocess.run([program,'-w','5',*arguments],env=core['CLEAN_ENV'],capture_output=True,timeout=8)
  require(len(result.stdout)<=65536 and len(result.stderr)<=65536,'Desktop guard 输出过大')
  if not accept: require(result.returncode==0,'Desktop VNC owner guard 未确认')
  return result
 jump=['-d','127.0.0.1/32','-p','tcp','--dport','5901','-m','comment','--comment',comment,'-j',chain]
 rules=[['-m','owner','--uid-owner','0','-j','RETURN'],['-m','owner','--uid-owner',str(identity['uid']),'-j','RETURN'],['-j','REJECT']]
 if op=='guard':
  require(invoke(['-S',chain],True).returncode!=0,'Desktop 同名 guard 不明，拒绝接管')
  adapter_stage='GUARD_RUNTIME'
  for parent in ['/run/sakura-desktop-uid','/run/sakura-desktop-uid/'+str(identity['uid'])]: core['make_directory'](parent,0o711)
  require(len(list(Path(proof['runtime']).parent.iterdir()))<128,'Desktop 私有 runtime 达到上限')
  os.mkdir(proof['runtime'],0o700)
  runtime=os.open(proof['runtime'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   os.fchown(runtime,0,0)
   info=os.fstat(runtime)
   expected.update(networkDevice=str(network.st_dev),networkInode=str(network.st_ino),runtimeDevice=str(info.st_dev),runtimeInode=str(info.st_ino),phase='creating')
   try: core['json_write'](str(path),expected)
   except BaseException:
    current=os.lstat(proof['runtime'])
    if (current.st_dev,current.st_ino)==(info.st_dev,info.st_ino): os.rmdir(proof['runtime'])
    raise
   os.fchown(runtime,identity['uid'],identity['gid'])
  finally: os.close(runtime)
  adapter_stage='GUARD_FIREWALL'
  invoke(['-N',chain])
  for rule in rules: invoke(['-A',chain,*rule])
  invoke(['-I','OUTPUT','1',*jump]); expected['phase']='active'; core['json_write'](str(path),expected); return {'guarded':True}
 if receipt is None:
  require(op=='unguard' and invoke(['-S',chain],True).returncode!=0 and invoke(['-C','OUTPUT',*jump],True).returncode!=0,
          'Desktop 缺少原 guard receipt，拒绝接管同名规则')
  require(not os.path.lexists(proof['runtime']),'Desktop 缺少原 runtime inode 票据，拒绝接管残留目录'); return {'guarded':False}
 present=invoke(['-S',chain],True)
 if present.returncode==0:
  existing=[rule for rule in rules if invoke(['-C',chain,*rule],True).returncode==0]
  require(len(present.stdout.splitlines())==1+len(existing),'Desktop guard 规则已变化')
  attached=invoke(['-C','OUTPUT',*jump],True).returncode==0
  if op!='unguard': require(receipt['phase']=='active' and len(existing)==3 and attached,'Desktop 原 guard 未提交')
  if op=='unguard':
   if attached: invoke(['-D','OUTPUT',*jump])
   for rule in reversed(existing): invoke(['-D',chain,*rule])
   invoke(['-X',chain])
 else: require(op=='unguard' and invoke(['-C','OUTPUT',*jump],True).returncode!=0,'Desktop 原 guard 已失效')
 if op=='unguard': retire_runtime(proof,receipt); core['durable_unlink'](str(path)); return {'guarded':False}
 return {'guarded':True}

def stream(proof):
 global adapter_stage
 adapter_stage='AUTHORITY'
 checked=desktop_authority(proof)
 os.close(checked['directoryFd'])
 adapter_stage='STREAM_NETWORK'
 core=desktop_native(proof['run']['build']); lock=core['initialize_readonly']()
 try: net,_,_=core['network_fd'](proof['identity'],proof['run']['bootId'],True)
 finally: os.close(lock)
 try: require(ctypes.CDLL(None,use_errno=True).setns(net,0x40000000)==0,'Desktop VNC 无法进入原网络')
 finally: os.close(net)
 adapter_stage='STREAM_RELAY'
 peer=socket.create_connection(('127.0.0.1',5901),timeout=3)
 try:
  adapter_stage='AUTHORITY'
  checked=desktop_authority(proof); os.close(checked['directoryFd'])
  adapter_stage='STREAM_RELAY'
  peer.setblocking(False); os.set_blocking(0,False); os.set_blocking(1,False)
  upstream=bytearray(); downstream=bytearray(); input_open=True; peer_open=True
  while peer_open or downstream:
   reads=([peer] if peer_open and len(downstream)<262144 else [])+([0] if input_open and len(upstream)<262144 else [])
   writes=([peer] if upstream else [])+([1] if downstream else [])
   ready,writable,_=select.select(reads,writes,[],30)
   for item in ready:
    data=peer.recv(65536) if item==peer else os.read(0,65536)
    if not data:
     if item==peer: peer_open=False; input_open=False; upstream.clear()
     else: input_open=False
    elif item==peer: downstream.extend(data)
    else: upstream.extend(data)
   for item in writable:
    if item==peer:
     try: del upstream[:peer.send(upstream)]
     except BrokenPipeError: upstream.clear(); input_open=False
    else: del downstream[:os.write(1,downstream)]
   if not input_open and not upstream and peer_open:
    try: peer.shutdown(socket.SHUT_WR)
    except OSError: pass
 finally: peer.close()

try:
 require(len(sys.argv)==2 and len(sys.argv[1])<=131072,'Desktop adapter 请求过大')
 request=json.loads(base64.b64decode(sys.argv[1],validate=True)); os.environ.clear()
 require(set(request)=={'op','proof'} and request['op'] in ('probe','stream','guard','guard-probe','unguard'),'Desktop adapter 操作无效')
 proof=request['proof']
 if request['op'] in ('guard','guard-probe','unguard'): result=guard(proof,request['op'])
 else:
  require(proof['run'] is not None,'Desktop 未确认发行原 native ticket')
  authority={key:value for key,value in proof.items() if key!='build'}
  guard(proof,'guard-probe')
  if request['op']=='stream': stream(authority); sys.exit(0)
  adapter_stage='AUTHORITY'
  checked=desktop_authority(authority); os.close(checked['directoryFd']); result={'endpoint':checked['endpoint']}
 print(json.dumps({'ok':True,'result':result}))
except Exception as error:
 # Binary RFB must never receive diagnostics or JSON error bytes on stdout.
 refusal=desktop_adapter_refusal(error,adapter_stage)
 print('SAKURA_DESKTOP_ADAPTER_REFUSED '+refusal['stage']+':'+refusal['reason']+':'+str(refusal['checkLine']),file=sys.stderr)
 if 'request' not in globals() or request.get('op')!='stream':
  print(json.dumps(refusal))
 sys.exit(73)
`;

export function desktopProjectCommand(op: 'probe' | 'stream' | 'guard' | 'guard-probe' | 'unguard', proof: DesktopControlProof) {
  proof = desktopControlProofSchema.parse(proof);
  if (['probe', 'stream'].includes(op) && !proof.run)
    throw new AppError('Desktop 尚无原完整 native ticket', 409, 'DESKTOP_SCOPE_CHANGED');
  const metadata = Buffer.from(JSON.stringify({ op, proof })).toString('base64');
  return `# SAKURA_PROJECT_DESKTOP_REQUEST=${metadata}\n${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(desktopAdapterSource)} ${quote(metadata)}`;
}
export async function desktopProjectControl(machines: Machines, id: string, op: 'probe' | 'guard' | 'guard-probe' | 'unguard',
  proof: DesktopControlProof, signal?: AbortSignal) {
  const result = await machines.exec(id, desktopProjectCommand(op, proof), 40000, signal);
  let reply: { ok?: boolean; code?: string; result?: unknown } | null;
  try { reply = JSON.parse(result.stdout); } catch { throw new AppError('Desktop 固定 adapter 没有可核对回执', 503, 'DESKTOP_CONTROL_FAILED'); }
  if (result.code !== 0 || !reply || typeof reply !== 'object' || reply.ok !== true) {
    const refusal = adapterRefusalSchema.safeParse(reply);
    const waiting = refusal.success && refusal.data.stage === 'AUTHORITY' &&
      ['NOT_READY_CREDENTIAL', 'NOT_READY_PROCESS', 'NOT_READY_NESTED_X11'].includes(refusal.data.reason);
    if (op === 'probe' && proof.endpoint === null && refusal.success && refusal.data.code === 'DESKTOP_NOT_READY' && waiting)
      throw new AppError('Desktop 原会话正在准备图形端点', 409, 'DESKTOP_NOT_READY');
    const code = Number.isInteger(result.code) && result.code >= -1 && result.code <= 255 ? String(result.code) : 'unknown';
    const detail = refusal.success ? refusal.data.stage + '/' + refusal.data.reason + '/check=' + refusal.data.checkLine : 'UNVERIFIED_REPLY';
    throw new AppError('Desktop 原 UID、完整运行域或 VNC guard 未确认（' + op + '/' + detail + '；exit=' + code + '）',
    op === 'unguard' ? 503 : 409, op === 'unguard' ? 'DESKTOP_CLEANUP_FAILED' : 'DESKTOP_SCOPE_CHANGED');
  }
  return op === 'probe' ? z.object({ endpoint: desktopEndpointSchema }).strict().parse(reply.result)
    : z.object({ guarded: z.boolean() }).strict().parse(reply.result);
}
