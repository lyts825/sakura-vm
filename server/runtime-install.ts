import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';

const tool = z.enum(['node', 'python']), version = z.string().regex(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const runtimeInstallReceiptSchema = z.object({ version: z.literal(1), tool,
  architecture: z.enum(['x86_64', 'aarch64']),
  requestedVersion: version, phase: z.enum(['prepared', 'ready']), installId: z.uuid(),
  directoryDevice: decimal, directoryInode: decimal, executableDevice: decimal,
  executableInode: decimal, executableSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RuntimeInstallReceipt = z.infer<typeof runtimeInstallReceiptSchema>;
const installReplySchema = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), ok: z.literal(true), result: runtimeInstallReceiptSchema.nullable() }).strict(),
  z.object({ version: z.literal(1), ok: z.literal(false), code: z.string().regex(/^[A-Z_]{1,64}$/) }).strict(),
]);
function installReply(result: { code: number; stdout: string; stderr: string }) {
  let value: z.infer<typeof installReplySchema>;
  try {
    if (Buffer.byteLength(result.stdout) > 4096) throw new Error();
    value = installReplySchema.parse(JSON.parse(result.stdout));
  } catch { throw new AppError('运行时安装未返回可核对回执', 502, 'RUNTIME_INSTALL_REPLY'); }
  if (!value.ok) throw new AppError('运行时安装归属核对失败（' + value.code + '）', 409, 'RUNTIME_' + value.code);
  if (result.code !== 0) throw new AppError('运行时安装控制请求未完整结束', 502, 'RUNTIME_INSTALL_REPLY');
  return value.result;
}
export function parseRuntimeInstall(result: { code: number; stdout: string; stderr: string },
  expected: { tool: 'node' | 'python'; version: string; phase: 'prepared' | 'ready'; installId?: string;
    architecture?: 'x86_64' | 'aarch64' }) {
  const receipt = installReply(result);
  if (!receipt || receipt.tool !== expected.tool ||
      receipt.requestedVersion !== expected.version || receipt.phase !== expected.phase ||
      (expected.architecture !== undefined && receipt.architecture !== expected.architecture) ||
      (expected.installId !== undefined && receipt.installId !== expected.installId))
    throw new AppError('运行时安装回执身份不完整', 502, 'RUNTIME_INSTALL_REPLY');
  return receipt;
}
export function parseRuntimeInstallRecovery(result: { code: number; stdout: string; stderr: string },
  expected: { tool: 'node' | 'python'; version: string; architecture: 'x86_64' | 'aarch64' }) {
  const value = installReply(result);
  if (value !== null && (value.tool !== expected.tool || value.requestedVersion !== expected.version ||
      value.architecture !== expected.architecture || value.phase !== 'ready'))
    throw new AppError('运行时安装清理回执身份不完整', 502, 'RUNTIME_INSTALL_REPLY');
  return value;
}

const fixedEnvironment = '/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C';
const allowedNetwork = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy',
  'no_proxy', 'NPM_CONFIG_REGISTRY', 'PIP_INDEX_URL']);
// Only this administrator control plane installs shared artifacts. uv's own
// interpreter queries remain root operations with a fixed, clean environment.
// It never loads project PATH, environment, declarations or secret references.
const controller = String.raw`import errno,fcntl,hashlib,json,os,re,shutil,stat,subprocess,sys,uuid
ROOT='/opt/sakura-runtimes'
STATE='/var/lib/sakura/runtime-versions'
CGROUP='/sys/fs/cgroup'
class Refused(Exception):
    def __init__(self,code): self.code=code
def refuse(code): raise Refused(code)
def pairs(items):
    value={}
    for key,item in items:
        if key in value: refuse('RECEIPT_INVALID')
        value[key]=item
    return value
def info(value): return {'device':str(value.st_dev),'inode':str(value.st_ino)}
def exact(value,expected): return info(value)==expected
def created_directory(path,mode):
    # mkdir's mode is reduced by the private task's umask. Restore only this
    # newly-created, still-pinned directory; never chmod an existing pathname.
    os.mkdir(path,mode); before=os.lstat(path)
    if before.st_uid!=0 or not stat.S_ISDIR(before.st_mode) or before.st_mode&(0o022|0o6000): refuse('PATH_OWNER')
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        opened=os.fstat(fd)
        if not exact(opened,info(before)) or not stat.S_ISDIR(opened.st_mode) or opened.st_uid!=0: refuse('PATH_CHANGED')
        os.fchmod(fd,mode); after=os.fstat(fd)
        if not exact(after,info(before)) or stat.S_IMODE(after.st_mode)!=mode: refuse('PATH_CHANGED')
        return after
    finally: os.close(fd)
def safe(path,kind='dir',create=False,mode=0o755):
    current=''
    for part in path.split('/')[1:]:
        current+='/'+part
        try: value=os.lstat(current)
        except FileNotFoundError:
            if not create: refuse('PATH_ABSENT')
            value=created_directory(current,mode if current==path else 0o755)
        final=current==path
        if value.st_uid!=0 or value.st_mode&0o022 or stat.S_ISLNK(value.st_mode): refuse('PATH_OWNER')
        if not (stat.S_ISREG(value.st_mode) if final and kind=='file' else stat.S_ISDIR(value.st_mode)): refuse('PATH_TYPE')
    return value
def publication_root():
    current=ROOT
    while True:
        value=os.lstat(current)
        if value.st_uid!=0 or not stat.S_ISDIR(value.st_mode) or value.st_mode&0o022: refuse('PATH_OWNER')
        if not value.st_mode&0o001: refuse('PATH_ACCESS')
        if current=='/': break
        current=os.path.dirname(current)
    if stat.S_IMODE(os.lstat(ROOT).st_mode)!=0o755: refuse('PATH_ACCESS')
def read_receipt(path):
    try: fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    except FileNotFoundError: return None
    try:
        value=os.fstat(fd)
        if not stat.S_ISREG(value.st_mode) or value.st_uid!=0 or stat.S_IMODE(value.st_mode)!=0o600 or value.st_nlink!=1 or value.st_size>16384: refuse('RECEIPT_INVALID')
        data=os.read(fd,16385)
        if len(data)!=value.st_size: refuse('RECEIPT_INVALID')
        return json.loads(data.decode('utf-8'),object_pairs_hook=pairs)
    except (UnicodeError,ValueError): refuse('RECEIPT_INVALID')
    finally: os.close(fd)
def durable(path,value):
    temporary=path+'.tmp'
    # The global EX lock permits only one bounded private pending write. A
    # killed writer cannot accumulate arbitrary temporary receipt files.
    if os.path.lexists(temporary):
        metadata=safe(temporary,'file')
        if stat.S_IMODE(metadata.st_mode)!=0o600 or metadata.st_nlink!=1 or metadata.st_size>16384: refuse('RECEIPT_INVALID')
        os.unlink(temporary); sync(STATE)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        try:
            data=json.dumps(value,separators=(',',':'),ensure_ascii=True).encode('ascii')
            if len(data)>16384: refuse('RECEIPT_INVALID')
            with os.fdopen(fd,'wb',closefd=False) as stream: stream.write(data); stream.flush(); os.fsync(fd)
        finally: os.close(fd)
        os.replace(temporary,path); sync(STATE)
    finally:
        if os.path.lexists(temporary): os.unlink(temporary)
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
def boot():
    with open('/proc/sys/kernel/random/boot_id','r',encoding='ascii') as stream: value=stream.read(64).strip()
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value): refuse('BOOT_ID')
    return value
def cgroup_mount():
    with open('/proc/self/mountinfo','r',encoding='ascii') as stream:
        for line in stream:
            parts=line.split()
            if len(parts)>9 and parts[4]==CGROUP and '-' in parts and parts[parts.index('-')+1]=='cgroup2': return
    refuse('CGROUP_INVALID')
def capture_scope(run_id):
    name='sakura-task-'+run_id
    with open('/proc/self/cgroup','r',encoding='ascii') as stream: membership=stream.read(4096)
    if membership!='0::/'+name+'\n': refuse('CGROUP_MEMBERSHIP')
    cgroup_mount(); value=safe(CGROUP+'/'+name)
    return {'name':name,'bootId':boot(),**info(value)}
def stopped(scope):
    cgroup_mount(); safe(CGROUP)
    path=CGROUP+'/'+scope['name']
    try: fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    except FileNotFoundError: return
    try:
        value=os.fstat(fd)
        if scope['bootId']!=boot() or not exact(value,{'device':scope['device'],'inode':scope['inode']}): refuse('INSTALL_SCOPE_CHANGED')
        event=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
        try: text=os.read(event,4096).decode('ascii')
        finally: os.close(event)
        if not re.search(r'^populated 0$',text,re.M): refuse('INSTALL_SCOPE_ACTIVE')
    finally: os.close(fd)
def validate(value):
    expected={'version','tool','architecture','requestedVersion','phase','installId','scope','stage','stageInfo','managedPath','managedInfo','artifactInfo','executableInfo','executableSha256'}
    if not isinstance(value,dict) or set(value)!=expected or value['version']!=1 or value['tool']!=REQUEST['tool'] or value['requestedVersion']!=REQUEST['version'] or value['phase'] not in ('building','publishing','prepared','ready'): refuse('RECEIPT_INVALID')
    if value['architecture']!=REQUEST['architecture']: refuse('INSTALL_ARCH')
    if not isinstance(value['installId'],str) or str(uuid.UUID(value['installId']))!=value['installId']: refuse('RECEIPT_INVALID')
    if value['stage']!=ROOT+'/.install-'+value['installId']: refuse('RECEIPT_INVALID')
    if value['managedPath']!=(ROOT+'/python-managed-'+value['installId'] if value['tool']=='python' else None): refuse('RECEIPT_INVALID')
    if value['tool']=='node' and value['managedInfo'] is not None: refuse('RECEIPT_INVALID')
    scope=value['scope']
    if not isinstance(scope,dict) or set(scope)!={'name','bootId','device','inode'} or not re.fullmatch(r'sakura-task-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',scope['name']) or str(uuid.UUID(scope['bootId']))!=scope['bootId']: refuse('RECEIPT_INVALID')
    for key in ('device','inode'):
        if not isinstance(scope[key],str) or not re.fullmatch(r'[1-9][0-9]*',scope[key]): refuse('RECEIPT_INVALID')
    for key in ('stageInfo','managedInfo','artifactInfo','executableInfo'):
        item=value[key]
        if item is not None and (not isinstance(item,dict) or set(item)!={'device','inode'} or any(not isinstance(part,str) or not re.fullmatch(r'[1-9][0-9]*',part) for part in item.values())): refuse('RECEIPT_INVALID')
    if value['phase']!='building' and (value['stageInfo'] is None or value['artifactInfo'] is None or value['executableInfo'] is None or not isinstance(value['executableSha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['executableSha256'])): refuse('RECEIPT_INVALID')
    if value['tool']=='python' and value['phase']!='building' and value['managedInfo'] is None: refuse('RECEIPT_INVALID')
    if value['phase']=='building' and any(value[key] is not None for key in ('artifactInfo','executableInfo','executableSha256')): refuse('RECEIPT_INVALID')
def resolved(path,artifact,managed=None):
    roots=(artifact,) if managed is None else (artifact,managed)
    def contained(value): return any(value==root or value.startswith(root+'/') for root in roots)
    current=os.path.normpath(path)
    if not contained(current): refuse('ARTIFACT_LINK')
    # Every hop stays inside the recorded roots. A /tmp alias which happens
    # to resolve back inside today is not a trusted interpreter link.
    for _ in range(64):
        partial=''; parts=current.split('/')[1:]; changed=False
        for index,part in enumerate(parts):
            partial+='/'+part
            try: value=os.lstat(partial)
            except OSError: refuse('ARTIFACT_LINK')
            if value.st_uid!=0: refuse('ARTIFACT_OWNER')
            if stat.S_ISLNK(value.st_mode):
                link=os.readlink(partial)
                current=os.path.normpath((link if link.startswith('/') else os.path.dirname(partial)+'/'+link)+('/'+'/'.join(parts[index+1:]) if index+1<len(parts) else ''))
                if not contained(current): refuse('ARTIFACT_LINK')
                changed=True; break
            if index+1<len(parts) and not stat.S_ISDIR(value.st_mode): refuse('ARTIFACT_LINK')
        if not changed: return current
    refuse('ARTIFACT_LINK')
def target(path,artifact,managed=None):
    real=resolved(path,artifact,managed)
    safe(real,'dir' if os.path.isdir(real) else 'file')
    return real
def walk_error(_error): refuse('ARTIFACT_READ')
def tree(artifact,managed=None,root_modes=(0o755,)):
    top=safe(artifact)
    if stat.S_IMODE(top.st_mode) not in root_modes: refuse('ARTIFACT_MODE')
    count=0
    for directory,dirs,files in os.walk(artifact,followlinks=False,onerror=walk_error):
        value=safe(directory)
        if stat.S_IMODE(value.st_mode) not in (root_modes if directory==artifact else (0o755,)): refuse('ARTIFACT_MODE')
        for name in dirs+files:
            count+=1
            if count>100000: refuse('ARTIFACT_LIMIT')
            path=directory+'/'+name; value=os.lstat(path)
            if value.st_uid!=0 or (not stat.S_ISLNK(value.st_mode) and value.st_mode&(0o022|0o6000)): refuse('ARTIFACT_OWNER')
            if stat.S_ISLNK(value.st_mode): target(path,artifact,managed)
            elif not (stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode)): refuse('ARTIFACT_TYPE')
            elif stat.S_IMODE(value.st_mode) not in ((0o755,) if stat.S_ISDIR(value.st_mode) else (0o644,0o755)): refuse('ARTIFACT_MODE')
def normalized(path,expected,guard,guard_info,managed=None,root_mode=0o755):
    # The entire new tree remains below a pinned root-only ancestor while
    # downloader permissions (including uv's 0666 lock) are normalized. Scan
    # first, then chmod only matching NOFOLLOW descriptors. Existing shared
    # interpreter directories are never inputs to this function.
    if not (path==guard or path.startswith(guard+'/')): refuse('ARTIFACT_CHANGED')
    if not exact(safe(guard),guard_info) or stat.S_IMODE(os.lstat(guard).st_mode)!=0o700: refuse('ARTIFACT_CHANGED')
    top=safe(path)
    if not exact(top,expected): refuse('ARTIFACT_CHANGED')
    entries=[(path,top)]; links={}; size=len(path)
    for directory,dirs,files in os.walk(path,followlinks=False,onerror=walk_error):
        for name in dirs+files:
            child=directory+'/'+name; value=os.lstat(child); size+=len(child)
            if len(entries)>=100000 or size>16*1024*1024: refuse('ARTIFACT_LIMIT')
            if value.st_uid!=0 or (not stat.S_ISLNK(value.st_mode) and value.st_mode&0o6000): refuse('ARTIFACT_OWNER')
            if not (stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode)): refuse('ARTIFACT_TYPE')
            entries.append((child,value))
            if stat.S_ISREG(value.st_mode):
                key=(value.st_dev,value.st_ino); count,total=links.get(key,(0,value.st_nlink))
                if total!=value.st_nlink: refuse('ARTIFACT_CHANGED')
                links[key]=(count+1,total)
    if any(count!=total for count,total in links.values()): refuse('ARTIFACT_LINK')
    # Check links without using safe() on still-unfixed 0666 files. Canonical
    # targets must exist inside this tree or the exact recorded managed tree.
    for child,value in entries:
        if stat.S_ISLNK(value.st_mode):
            real=resolved(child,path,managed)
            destination=os.lstat(real)
            if destination.st_uid!=0 or not (stat.S_ISDIR(destination.st_mode) or stat.S_ISREG(destination.st_mode)): refuse('ARTIFACT_LINK')
    done=set()
    for child,before in reversed(entries):
        if stat.S_ISLNK(before.st_mode):
            current=os.lstat(child)
            if not exact(current,info(before)) or current.st_uid!=0 or not stat.S_ISLNK(current.st_mode): refuse('ARTIFACT_CHANGED')
            continue
        key=(before.st_dev,before.st_ino)
        if key in done: continue
        fd=os.open(child,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|(os.O_DIRECTORY if stat.S_ISDIR(before.st_mode) else 0))
        try:
            opened=os.fstat(fd)
            if not exact(opened,info(before)) or opened.st_uid!=0 or opened.st_mode!=before.st_mode or opened.st_nlink!=before.st_nlink: refuse('ARTIFACT_CHANGED')
            mode=root_mode if child==path else 0o755 if stat.S_ISDIR(before.st_mode) or before.st_mode&0o111 else 0o644
            os.fchmod(fd,mode); after=os.fstat(fd)
            if not exact(after,info(before)) or stat.S_IMODE(after.st_mode)!=mode: refuse('ARTIFACT_CHANGED')
            done.add(key)
        finally: os.close(fd)
    if not exact(safe(guard),guard_info) or stat.S_IMODE(os.lstat(guard).st_mode)!=0o700: refuse('ARTIFACT_CHANGED')
    tree(path,managed,(root_mode,))
def executable(artifact,managed=None):
    path=artifact+'/bin/'+('node' if REQUEST['tool']=='node' else 'python3')
    real=target(path,artifact,managed); fd=os.open(real,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not before.st_mode&0o111 or before.st_size>512*1024*1024: refuse('ARTIFACT_EXECUTABLE')
        digest=hashlib.sha256()
        while True:
            data=os.read(fd,1024*1024)
            if not data: break
            digest.update(data)
        after=os.fstat(fd)
        if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns): refuse('ARTIFACT_CHANGED')
        return info(before),digest.hexdigest()
    finally: os.close(fd)
def verified(value):
    validate(value)
    if value['phase'] not in ('prepared','ready'): refuse('INSTALL_INCOMPLETE')
    managed=value['managedPath']
    if managed is not None:
        if not exact(safe(managed),value['managedInfo']): refuse('ARTIFACT_CHANGED')
        tree(managed,root_modes=(0o755,) if value['phase']=='ready' else (0o700,0o755))
    if not exact(safe(DESTINATION),value['artifactInfo']): refuse('ARTIFACT_CHANGED')
    tree(DESTINATION,managed); identity,digest=executable(DESTINATION,managed)
    if identity!=value['executableInfo'] or digest!=value['executableSha256']: refuse('ARTIFACT_CHANGED')
def public(value):
    return {'version':1,'tool':value['tool'],'architecture':value['architecture'],'requestedVersion':value['requestedVersion'],'phase':value['phase'],'installId':value['installId'],
      'directoryDevice':value['artifactInfo']['device'],'directoryInode':value['artifactInfo']['inode'],
      'executableDevice':value['executableInfo']['device'],'executableInode':value['executableInfo']['inode'],'executableSha256':value['executableSha256']}
def remove_tree(path,expected):
    if not os.path.lexists(path): return
    if expected is None or not exact(safe(path),expected): refuse('CLEANUP_CHANGED')
    # Never follow links while removing a private stage or its exact artifact.
    shutil.rmtree(path); sync(ROOT)
def recover(value):
    validate(value); stopped(value['scope'])
    if value['phase']=='ready': verified(value); return
    # Preflight all recorded roots before removing any of them. A replaced
    # managed prefix must not cause partial cleanup of unrelated state.
    for path,expected in ((value['stage'],value['stageInfo']),(value['managedPath'],value['managedInfo'])):
        if path is not None and os.path.lexists(path) and (expected is None or not exact(safe(path),expected)): refuse('CLEANUP_CHANGED')
    if os.path.lexists(DESTINATION):
        if value['phase'] not in ('publishing','prepared'): refuse('DESTINATION_UNKNOWN')
        if not exact(safe(DESTINATION),value['artifactInfo']): refuse('CLEANUP_CHANGED')
        tree(DESTINATION,value['managedPath']); remove_tree(DESTINATION,value['artifactInfo'])
    remove_tree(value['stage'],value['stageInfo'])
    if value['managedPath'] is not None: remove_tree(value['managedPath'],value['managedInfo'])
    os.unlink(RECEIPT); sync(STATE)
def run(arguments,environment,cwd):
    if subprocess.run(arguments,cwd=cwd,env=environment,stdin=subprocess.DEVNULL,stdout=sys.stderr,stderr=sys.stderr).returncode!=0: refuse('INSTALL_TOOL_FAILED')
def build(value):
    stage=value['stage']; value['stageInfo']=info(created_directory(stage,0o700)); durable(RECEIPT,value)
    environment={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','LC_ALL':'C',**REQUEST['network']}
    artifact=stage+'/runtime'; version=REQUEST['version']
    artifact_info=info(created_directory(artifact,0o755))
    if REQUEST['tool']=='node':
        arch={'x86_64':'x64','aarch64':'arm64'}.get(os.uname().machine)
        if not arch: refuse('INSTALL_ARCH')
        name='node-v'+version+'-linux-'+arch+'.tar.xz'
        source='https://nodejs.org/dist/v'+version+'/'
        for filename in (name,'SHASUMS256.txt'):
            run(['/usr/bin/curl','--fail','--location','--proto','=https','--proto-redir','=https','--retry','2','--connect-timeout','20','--max-time','600','-o',stage+'/'+filename,source+filename],environment,stage)
        with open(stage+'/SHASUMS256.txt','r',encoding='ascii') as stream: lines=stream.read(1024*1024).splitlines()
        checks=[line.split()[0] for line in lines if line.endswith('  '+name)]
        if len(checks)!=1 or not re.fullmatch(r'[a-f0-9]{64}',checks[0]): refuse('INSTALL_CHECKSUM')
        digest=hashlib.sha256()
        with open(stage+'/'+name,'rb') as stream:
            while True:
                data=stream.read(1024*1024)
                if not data: break
                digest.update(data)
        if digest.hexdigest()!=checks[0]: refuse('INSTALL_CHECKSUM')
        run(['/usr/bin/tar','-xJf',stage+'/'+name,'-C',artifact,'--strip-components=1','--no-same-owner','--no-same-permissions'],environment,stage)
    else:
        downloads=value['managedPath']
        if os.path.lexists(downloads): refuse('MANAGED_UNKNOWN')
        value['managedInfo']=info(created_directory(downloads,0o700)); durable(RECEIPT,value)
        run(['/usr/bin/python3','-I','-m','venv',stage+'/uv'],environment,stage)
        run([stage+'/uv/bin/python','-I','-m','pip','install','--disable-pip-version-check','uv==0.10.11'],environment,stage)
        environment['UV_PYTHON_INSTALL_DIR']=downloads; environment['UV_CACHE_DIR']=stage+'/uv-cache'
        uv=stage+'/uv/bin/uv'
        run([uv,'--no-config','python','install','--managed-python',version],environment,stage)
        normalized(downloads,value['managedInfo'],downloads,value['managedInfo'],root_mode=0o700)
        # uv accepts this new, empty pinned directory without --clear. Copy
        # seeding avoids hardlinks to the private cache which is later retired.
        run([uv,'--no-config','venv','--no-project','--managed-python','--no-python-downloads','--python',version,'--relocatable','--seed','--link-mode','copy',artifact],environment,stage)
        normalized(downloads,value['managedInfo'],downloads,value['managedInfo'],root_mode=0o700)
    normalized(artifact,artifact_info,stage,value['stageInfo'],value['managedPath'])
    identity,digest=executable(artifact,value['managedPath'])
    value.update(phase='publishing',artifactInfo=info(safe(artifact)),executableInfo=identity,executableSha256=digest)
    durable(RECEIPT,value)
    if os.path.lexists(DESTINATION): refuse('DESTINATION_UNKNOWN')
    os.rename(artifact,DESTINATION); sync(ROOT)
    value['phase']='prepared'; durable(RECEIPT,value)
    verified(value)
    return public(value)
def main():
    if os.getuid()!=0 or os.geteuid()!=0: refuse('CONTROL_UID')
    if os.uname().machine!=REQUEST['architecture']: refuse('INSTALL_ARCH')
    operation=REQUEST['operation']; write=operation in ('prepare','confirm','recover')
    if operation in ('prepare','confirm') and REQUEST.get('bootId')!=boot(): refuse('BOOT_CHANGED')
    safe(ROOT,create=write); safe(STATE,create=write,mode=0o700)
    # Unknown older private roots are not silently opened to project users.
    # New roots receive 0755 through created_directory despite umask 077.
    publication_root()
    if stat.S_IMODE(os.lstat(STATE).st_mode)!=0o700: refuse('PATH_OWNER')
    flags=os.O_NOFOLLOW|os.O_NONBLOCK|(os.O_RDWR|os.O_CREAT if write else os.O_RDONLY)
    lock=os.open(STATE+'/lock',flags,0o600)
    try:
        metadata=os.fstat(lock)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid!=0 or stat.S_IMODE(metadata.st_mode)!=0o600 or metadata.st_nlink!=1: refuse('RECEIPT_INVALID')
        try: fcntl.flock(lock,(fcntl.LOCK_EX if write else fcntl.LOCK_SH)|fcntl.LOCK_NB)
        except BlockingIOError: refuse('INSTALL_BUSY')
        value=read_receipt(RECEIPT)
        if value is not None: validate(value)
        if operation=='verify':
            if value is None: refuse('DESTINATION_UNKNOWN')
            if value['phase']!='ready': refuse('INSTALL_INCOMPLETE')
            verified(value); return public(value)
        if operation=='confirm':
            if value is None or value['installId']!=REQUEST['installId']: refuse('INSTALL_ID_CHANGED')
            stopped(value['scope']); verified(value)
            remove_tree(value['stage'],value['stageInfo'])
            if value['managedPath'] is not None:
                fd=os.open(value['managedPath'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:
                    current=os.fstat(fd)
                    if not exact(current,value['managedInfo']) or current.st_uid!=0 or stat.S_IMODE(current.st_mode) not in (0o700,0o755): refuse('ARTIFACT_CHANGED')
                    os.fchmod(fd,0o755); os.fsync(fd)
                    if not exact(os.fstat(fd),value['managedInfo']) or stat.S_IMODE(os.fstat(fd).st_mode)!=0o755: refuse('ARTIFACT_CHANGED')
                finally: os.close(fd)
                tree(value['managedPath'])
            value['phase']='ready'; durable(RECEIPT,value); return public(value)
        if operation=='recover':
            if value is None:
                if os.path.lexists(DESTINATION): refuse('DESTINATION_UNKNOWN')
                return None
            if value['phase']=='ready': verified(value); return public(value)
            if REQUEST.get('installId') is not None and value['installId']!=REQUEST['installId']: refuse('INSTALL_ID_CHANGED')
            recover(value); return None
        if operation!='prepare': refuse('CONTROL_OPERATION')
        if value is not None:
            if value['phase']=='ready': verified(value); return public(value)
            # An explicit install retry may retire only its recorded partial
            # artifact after that exact previous task is confirmed stopped.
            recover(value)
        if os.path.lexists(DESTINATION): refuse('DESTINATION_UNKNOWN')
        scope=capture_scope(REQUEST['runId'])
        value={'version':1,'tool':REQUEST['tool'],'architecture':REQUEST['architecture'],'requestedVersion':REQUEST['version'],'phase':'building','installId':REQUEST['installId'],
          'scope':scope,'stage':ROOT+'/.install-'+REQUEST['installId'],'stageInfo':None,'managedPath':ROOT+'/python-managed-'+REQUEST['installId'] if REQUEST['tool']=='python' else None,
          'managedInfo':None,'artifactInfo':None,'executableInfo':None,'executableSha256':None}
        if os.path.lexists(value['stage']): refuse('STAGE_UNKNOWN')
        if value['managedPath'] is not None and os.path.lexists(value['managedPath']): refuse('MANAGED_UNKNOWN')
        durable(RECEIPT,value); return build(value)
    finally: os.close(lock)
try:
    DESTINATION=ROOT+'/'+REQUEST['tool']+'-'+REQUEST['version']
    RECEIPT=STATE+'/'+REQUEST['tool']+'-'+REQUEST['version']+'.json'
    response={'version':1,'ok':True,'result':main()}
except Refused as error: response={'version':1,'ok':False,'code':error.code}
except Exception: response={'version':1,'ok':False,'code':'CONTROL_FAILED'}
print(json.dumps(response,separators=(',',':'),ensure_ascii=True))
sys.exit(0 if response['ok'] else 73)
`;

export function runtimeInstallCommand(input: { operation: 'verify' | 'prepare' | 'confirm' | 'recover';
  tool: 'node' | 'python'; version: string; installId?: string; runId?: string;
  bootId?: string; architecture?: 'x86_64' | 'aarch64'; network?: Record<string, string> }) {
  tool.parse(input.tool); version.parse(input.version);
  if (input.installId !== undefined) z.uuid().parse(input.installId);
  if (input.runId !== undefined) z.uuid().parse(input.runId);
  if (input.bootId !== undefined) z.uuid().parse(input.bootId);
  if (input.operation === 'prepare' && (!input.installId || !input.runId)) throw new AppError('安装请求缺少固定身份');
  if (input.operation === 'confirm' && !input.installId) throw new AppError('安装确认缺少固定身份');
  if (['prepare', 'confirm'].includes(input.operation) && !input.bootId) throw new AppError('安装请求缺少开机身份');
  validateNetwork(input.network || {});
  const data = { ...input, architecture: z.enum(['x86_64', 'aarch64']).parse(input.architecture || 'x86_64'), network: input.network || {} };
  return `${fixedEnvironment} /usr/bin/python3 -I -S - <<'SAKURA_RUNTIME_INSTALL'\nimport json\nREQUEST=json.loads(${JSON.stringify(JSON.stringify(data))})\n${controller}SAKURA_RUNTIME_INSTALL`;
}
function validateNetwork(network: Record<string, string>) {
  for (const [key, content] of Object.entries(network))
    if (!allowedNetwork.has(key) || typeof content !== 'string' || content.length > 2048 || /[\x00-\x1f\x7f]/.test(content))
      throw new AppError('安装网络环境不符合固定白名单', 409, 'RUNTIME_INSTALL_ENVIRONMENT');
  for (const [key, content] of Object.entries(network)) if (!['NO_PROXY', 'no_proxy'].includes(key)) {
    let url: URL;
    try { url = new URL(content); } catch { throw new AppError('安装网络地址无效', 409, 'RUNTIME_INSTALL_ENVIRONMENT'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\s/.test(content))
      throw new AppError('安装网络地址不能包含凭证或查询参数', 409, 'RUNTIME_INSTALL_ENVIRONMENT');
  }
}
export function runtimeInstallSetup(distro?: string, network: Record<string, string> = {}) {
  validateNetwork(network);
  const script = !distro || distro === 'alpine'
    ? '/sbin/apk add --no-cache --timeout 30 python3 py3-pip py3-virtualenv curl ca-certificates tar xz coreutils'
    : '/usr/bin/apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n/usr/bin/apt-get -y install python3 python3-venv curl ca-certificates tar xz-utils';
  const environment = Object.entries(network).map(([name, value]) => name + '=' + quote(value)).join(' ');
  return `${fixedEnvironment} ${environment} DEBIAN_FRONTEND=noninteractive /bin/sh -eu -c ${quote('cd /\n' + script)}`;
}
