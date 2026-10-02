/** Trusted root code. It copies only inert cache bytes and never reads project files or environment. */
export const projectCacheTransferControl = String.raw`
import base64,fcntl,hashlib,json,os,re,stat,sys,time,uuid
BASE='/run/sakura-project-cache-transfers'
LIMIT_FILE=64*1024*1024
LIMIT_TOTAL=512*1024*1024
LIMIT_NODES=65536
LIMIT_DEPTH=32
DEADLINE=time.monotonic()+90
UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
def fail(): raise RuntimeError('CACHE_TRANSFER_PROOF_REFUSED')
def tick():
 if time.monotonic()>DEADLINE: fail()
def trusted(info,directory=False):
 if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or info.st_uid!=0 or info.st_mode&0o022 or (not directory and info.st_nlink!=1): fail()
def root_fd(path):
 if not path.startswith('/') or any(not p or p in ('.','..') for p in path.split('/')[1:]): fail()
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
 try:
  trusted(os.fstat(fd),True)
  for part in path.split('/')[1:]:
   nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
   os.close(fd);fd=nxt;trusted(os.fstat(fd),True)
  return fd
 except BaseException: os.close(fd);raise
def same(a,b): return a.st_dev==b.st_dev and a.st_ino==b.st_ino
def bytes_read(fd,limit):
 value=b''
 while True:
  part=os.read(fd,min(65536,limit+1-len(value)))
  if not part: break
  value+=part
  if len(value)>limit: fail()
 return value
def read_at(parent,name,limit=16384):
 fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=parent)
 try:
  info=os.fstat(fd);trusted(info)
  if name=='receipt.json' and stat.S_IMODE(info.st_mode)!=0o600: fail()
  return bytes_read(fd,limit)
 finally: os.close(fd)
def json_at(parent,name):
 raw=read_at(parent,name)
 def pairs(items):
  result={}
  for key,value in items:
   if key in result: fail()
   result[key]=value
  return result
 return json.loads(raw.decode('utf-8','strict'),object_pairs_hook=pairs)
def write_all(fd,data):
 while data:
  count=os.write(fd,data)
  if count<=0: fail()
  data=data[count:]
def atomic_at(parent,name,value,expected=None):
 if expected is None:
  try: os.stat(name,dir_fd=parent,follow_symlinks=False);fail()
  except FileNotFoundError: pass
 elif json_at(parent,name)!=expected: fail()
 temporary='.'+str(uuid.uuid4())
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
 try: write_all(fd,json.dumps(value,sort_keys=True,separators=(',',':')).encode());os.fsync(fd)
 finally: os.close(fd)
 os.rename(temporary,name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
def native(build):
 if not isinstance(build,str) or not re.fullmatch('[a-f0-9]{64}',build): fail()
 folder='/usr/local/lib/sakura-project-identity/'+build
 fd=root_fd(folder)
 try:
  manifest=json.loads(read_at(fd,'manifest.json',16384))
  if not isinstance(manifest,dict) or set(manifest)!={'version','build','files'} or manifest['version']!=1 or manifest['build']!=build or not isinstance(manifest['files'],list) or len(manifest['files'])!=3: fail()
  aggregate=hashlib.sha256();module=None
  for name,row in zip(['protocol.h','launcher.c','controller.py'],manifest['files']):
   if not isinstance(row,dict) or set(row)!={'name','size','sha256'} or row['name']!=name: fail()
   data=read_at(fd,name,262144)
   if row['size']!=len(data) or row['sha256']!=hashlib.sha256(data).hexdigest(): fail()
   aggregate.update(name.encode());aggregate.update(data)
   if name=='controller.py': module=data
  if aggregate.hexdigest()!=build: fail()
  launch=os.stat('launch',dir_fd=fd,follow_symlinks=False);trusted(launch)
  if stat.S_IMODE(launch.st_mode)!=0o4755: fail()
 finally: os.close(fd)
 ns={'__name__':'sakura_cache_transfer_native','__file__':folder+'/controller.py'}
 exec(compile(module,folder+'/controller.py','exec'),ns)
 if ns['sources']()!=build: fail()
 return ns
def owner_check(owner):
 if not isinstance(owner,dict) or set(owner)!={'stageId','manager','build','identity','owner','sha256'}: fail()
 if not isinstance(owner['stageId'],str) or not UUID.fullmatch(owner['stageId']) or owner['manager'] not in ('npm','pip') or not re.fullmatch('[a-f0-9]{64}',owner['sha256']): fail()
 task=owner['owner'];identity=owner['identity']
 if not isinstance(task,dict) or set(task)!={'kind','runId','bootId'} or task['kind']!='task' or not UUID.fullmatch(task['runId']) or not UUID.fullmatch(task['bootId']): fail()
 if not isinstance(identity,dict) or not re.fullmatch('default|[a-f0-9]{16}',identity.get('projectId','')) or identity.get('phase')!='active': fail()
def absent(ns,owner):
 ns['cgroup_available']()
 fd=root_fd('/sys/fs/cgroup')
 try:
  try: os.stat('sakura-task-'+owner['owner']['runId'],dir_fd=fd,follow_symlinks=False);fail()
  except FileNotFoundError: pass
 finally: os.close(fd)
def proof(fd):
 info=os.fstat(fd);return {'device':str(info.st_dev),'inode':str(info.st_ino)}
def record_check(record,owner,stage,parent):
 if not isinstance(record,dict) or set(record)!={'version','phase','owner','stage','data','manifest','task'} or record['version']!=1 or record['owner']!=owner or record['phase'] not in ('copying','ready','retiring','closed'): fail()
 if record['stage']!=proof(stage) or not same(os.stat(owner['stageId'],dir_fd=parent,follow_symlinks=False),os.fstat(stage)): fail()
 if record['phase']=='closed':
  try: os.stat('data',dir_fd=stage,follow_symlinks=False);fail()
  except FileNotFoundError: pass
 else:
  try: data=os.stat('data',dir_fd=stage,follow_symlinks=False)
  except FileNotFoundError:
   if record['phase']!='retiring': fail()
   data=None
  if data is not None and (not stat.S_ISDIR(data.st_mode) or record['data']!={'device':str(data.st_dev),'inode':str(data.st_ino)} or data.st_uid not in (0,owner['identity']['uid']) or data.st_gid not in (0,owner['identity']['gid']) or stat.S_IMODE(data.st_mode)!=0o700): fail()
 return record
def mounts_safe(path):
 fd=os.open('/proc/self/mountinfo',os.O_RDONLY|os.O_CLOEXEC)
 try: raw=bytes_read(fd,1024*1024).decode('utf-8','strict')
 finally: os.close(fd)
 for line in raw.splitlines():
  fields=line.split()
  if len(fields)<6: fail()
  location=re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),fields[4])
  if location==path or location.startswith(path+'/'): fail()
def copy_tree(source,destination,identity,budget,digest,depth=0,relative='',selected=None):
 tick()
 if depth>LIMIT_DEPTH: fail()
 info=os.fstat(source);trusted(info,True)
 all_names=sorted(os.listdir(source));names=sorted(selected) if selected is not None else all_names
 if any(name not in all_names for name in names): fail()
 for name in names:
  tick();budget['nodes']+=1
  if budget['nodes']>LIMIT_NODES or not name or name in ('.','..') or '/' in name or len(os.fsencode(name))>255: fail()
  item=os.stat(name,dir_fd=source,follow_symlinks=False)
  if item.st_dev!=budget['sourceDevice']: fail()
  label=relative+'/'+name
  if stat.S_ISDIR(item.st_mode):
   trusted(item,True);child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=source)
   try:
    if not same(item,os.fstat(child)): fail()
    os.mkdir(name,0o700,dir_fd=destination);target=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=destination)
    try: copy_tree(child,target,identity,budget,digest,depth+1,label);os.fchown(target,identity['uid'],identity['gid']);os.fsync(target)
    finally: os.close(target)
   finally: os.close(child)
  else:
   trusted(item)
   if item.st_size<0 or item.st_size>LIMIT_FILE: fail()
   budget['bytes']+=item.st_size
   if budget['bytes']>LIMIT_TOTAL: fail()
   child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=source)
   try:
    before=os.fstat(child);trusted(before)
    if not same(item,before) or item.st_size!=before.st_size: fail()
    target=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=destination)
    try:
     total=0;sha=hashlib.sha256()
     while True:
      tick();data=os.read(child,65536)
      if not data: break
      total+=len(data)
      if total>before.st_size: fail()
      sha.update(data);write_all(target,data)
     after=os.fstat(child)
     if total!=before.st_size or (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)!=(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns): fail()
     os.fchown(target,identity['uid'],identity['gid']);os.fsync(target)
     digest.update(os.fsencode(label));digest.update(b'\0');digest.update(sha.digest())
    finally: os.close(target)
   finally: os.close(child)
 after=os.fstat(source)
 if sorted(os.listdir(source))!=all_names or (after.st_dev,after.st_ino,after.st_mtime_ns,after.st_ctime_ns)!=(info.st_dev,info.st_ino,info.st_mtime_ns,info.st_ctime_ns): fail()
 os.fsync(destination)
def remove_tree(parent,identity,device,budget,depth=0):
 tick()
 if depth>LIMIT_DEPTH: fail()
 for name in os.listdir(parent):
  tick();budget[0]+=1
  if budget[0]>LIMIT_NODES: fail()
  info=os.stat(name,dir_fd=parent,follow_symlinks=False)
  if info.st_dev!=device or info.st_uid not in (0,identity['uid']) or info.st_gid not in (0,identity['gid']): fail()
  if stat.S_ISDIR(info.st_mode):
   child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
   try:
    if not same(info,os.fstat(child)): fail()
    remove_tree(child,identity,device,budget,depth+1)
    if not same(info,os.stat(name,dir_fd=parent,follow_symlinks=False)): fail()
   finally: os.close(child)
   os.rmdir(name,dir_fd=parent)
  else:
   if not same(info,os.stat(name,dir_fd=parent,follow_symlinks=False)): fail()
   os.unlink(name,dir_fd=parent)
 os.fsync(parent)
def task_check(ns,owner,task,boot):
 if not isinstance(task,dict) or set(task)-{'run','retirement'} or 'run' not in task: fail()
 run=task['run'];original=owner['owner']['bootId']
 if boot!=original:
  if task.get('retirement')!={'reason':'guest-reboot','bootId':boot}: fail()
  return
 if 'retirement' in task: fail()
 if run is not None:
  ns['check_run'](owner['identity'],run,boot,False)
  if run['phase']!='closed' or run['mode']!='inherit-current' or run['runId']!=owner['owner']['runId'] or run['cgroupName']!='sakura-task-'+run['runId'] or run['build']!=owner['build'] or ns['run_read'](run['runId'])!=run: fail()
 else:
  try: ns['run_read'](owner['owner']['runId']);fail()
  except ns['Refusal'] as error:
   if error.code!='RECORD_ABSENT': raise
 absent(ns,owner)
def execute(request):
 os.umask(0o022)
 if os.getuid()!=0 or not isinstance(request,dict) or set(request)-{'action','owner','preparation','task'} or request.get('action') not in ('prepare','probe','retire'): fail()
 owner=request['owner'];owner_check(owner);action=request['action'];ns=native(owner['build'])
 parent=None;stage=None;lock=None
 # Keep all authority operations below in the original registry read lock.
 registry_lock=ns['initialize_readonly']()
 try:
  fd=os.open('/proc/sys/kernel/random/boot_id',os.O_RDONLY|os.O_CLOEXEC)
  try: boot=bytes_read(fd,100).decode().strip()
  finally: os.close(fd)
  if not UUID.fullmatch(boot): fail()
  if action=='prepare':
   if boot!=owner['owner']['bootId']: fail()
   expected={k:owner['identity'][k] for k in ('registryId','identityId','revision')}
   actual=ns['active'](owner['identity']['projectId'],{'expected':expected},ns['registry'](True))
   if actual!=owner['identity']: fail()
   # A new copy belongs only to the unissued original task. Archived/closed
   # native UUIDs cannot acquire a fresh stage and replay this preparation.
   try: ns['run_read'](owner['owner']['runId']);fail()
   except ns['Refusal'] as error:
    if error.code!='RECORD_ABSENT': raise
   absent(ns,owner)
   ns['make_directory'](BASE,0o711)
  try: parent=root_fd(BASE)
  except FileNotFoundError:
   if action=='prepare' or (request.get('preparation') is not None and boot==owner['owner']['bootId']): fail()
   if action=='retire': task_check(ns,owner,request['task'],boot)
   return {'version':1,'state':'absent','bootId':boot}
  if stat.S_IMODE(os.fstat(parent).st_mode)!=0o711: fail()
  if action=='prepare':
   lock=os.open('lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
  else:
   try: lock=os.open('lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
   except FileNotFoundError: fail()
  trusted(os.fstat(lock))
  if stat.S_IMODE(os.fstat(lock).st_mode)!=0o600: fail()
  while True:
   try: fcntl.flock(lock,(fcntl.LOCK_SH if action=='probe' else fcntl.LOCK_EX)|fcntl.LOCK_NB);break
   except BlockingIOError: tick();time.sleep(.01)
  if action=='prepare':
   os.mkdir(owner['stageId'],0o711,dir_fd=parent);os.fsync(parent)
  try: stage=os.open(owner['stageId'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
  except FileNotFoundError:
   if action=='prepare' or (request.get('preparation') is not None and boot==owner['owner']['bootId']): fail()
   if action=='retire': task_check(ns,owner,request['task'],boot)
   return {'version':1,'state':'absent','bootId':boot}
  trusted(os.fstat(stage),True)
  if stat.S_IMODE(os.fstat(stage).st_mode)!=0o711: fail()
  if action=='prepare':
   os.mkdir('data',0o700,dir_fd=stage);data=os.open('data',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=stage)
   try:
    record={'version':1,'phase':'copying','owner':owner,'stage':proof(stage),'data':proof(data),'manifest':None,'task':None}
    atomic_at(stage,'receipt.json',record)
    cache='/var/cache/sakura/project-deps/'+owner['identity']['projectId']+'/'+owner['manager']
    source=root_fd(cache)
    try:
     names=['LOCKSUMS','data' if owner['manager']=='npm' else 'wheels']
     # A shallow view fd copies exactly these roots, never credentials/staging dirs.
     for name in names:
      item=os.stat(name,dir_fd=source,follow_symlinks=False)
      trusted(item,stat.S_ISDIR(item.st_mode))
     digest=hashlib.sha256();budget={'nodes':0,'bytes':0,'sourceDevice':os.fstat(source).st_dev}
     copy_tree(source,data,owner['identity'],budget,digest,selected=names)
    finally: os.close(source)
    os.fchown(data,owner['identity']['uid'],owner['identity']['gid']);os.fsync(data);os.fsync(stage)
    ready={**record,'phase':'ready','manifest':{'sha256':digest.hexdigest(),'bytes':budget['bytes'],'nodes':budget['nodes']}}
    atomic_at(stage,'receipt.json',ready,record);record=ready
   finally: os.close(data)
  else:
   record=record_check(json_at(stage,'receipt.json'),owner,stage,parent)
   expected=request.get('preparation')
   if expected is not None and any(record[k]!=expected[k] for k in ('version','owner','stage','data','manifest')): fail()
  record_check(record,owner,stage,parent)
  if action=='probe': return {'version':1,'state':'present','bootId':boot,'receipt':record}
  if action=='retire':
   task_check(ns,owner,request['task'],boot)
   if boot!=owner['owner']['bootId']: fail()
   if record['phase']=='closed':
    if record['task']!=request['task']: fail()
    return {'version':1,'state':'present','bootId':boot,'receipt':record}
   if record['phase']=='retiring' and record['task']!=request['task']: fail()
   retiring={**record,'phase':'retiring','task':request['task']}
   if record!=retiring: atomic_at(stage,'receipt.json',retiring,record)
   record=retiring;mounts_safe(BASE+'/'+owner['stageId']);absent(ns,owner)
   try: data=os.open('data',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=stage)
   except FileNotFoundError: data=None
   if data is not None:
    try:
     if proof(data)!=record['data']: fail()
     info=os.fstat(data)
     if info.st_uid not in (0,owner['identity']['uid']) or info.st_gid not in (0,owner['identity']['gid']) or stat.S_IMODE(info.st_mode)!=0o700: fail()
     remove_tree(data,owner['identity'],info.st_dev,[0])
     if not same(info,os.stat('data',dir_fd=stage,follow_symlinks=False)): fail()
    finally: os.close(data)
    absent(ns,owner);os.rmdir('data',dir_fd=stage);os.fsync(stage)
   task_check(ns,owner,request['task'],boot)
   closed={**record,'phase':'closed'}
   atomic_at(stage,'receipt.json',closed,record);record=closed
  return {'version':1,'state':'present','bootId':boot,'receipt':record}
 finally:
  for fd in (stage,lock,parent,registry_lock):
   if fd is not None: os.close(fd)
if __name__=='__main__':
 try:
  raw=base64.b64decode(sys.argv[1],validate=True)
  if len(raw)>16384: fail()
  request=json.loads(raw.decode('utf-8','strict'))
  result=execute(request)
  print(json.dumps({'ok':True,'result':result},separators=(',',':')))
 except BaseException:
  print(json.dumps({'ok':False,'code':'CACHE_TRANSFER_PROOF_REFUSED'},separators=(',',':')))
  sys.exit(73)
`;
