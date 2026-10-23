/** 固定的只读源码捕获程序；由 DeliveryInputs.call 在项目 UID 任务内传入 JSON，输出有界清单或分块。
 * Fixed read-only source program; DeliveryInputs.call supplies JSON in a project-UID task and receives a bounded manifest or chunk.
 * 设计思路 / Design：git 禁用 hooks 与 fsmonitor，forbidden 排除秘密和缓存路径；
 * git disables hooks and fsmonitor, while forbidden excludes secret and cache paths.
 * regular 逐级无链接打开并核对普通文件，data 流式计算完整摘要，同时截取请求范围；
 * regular traverses without following links and checks ordinary files; data hashes all bytes while retaining only the requested range.
 * 提交读取固定 Git 对象，LFS 只用已在本地且摘要匹配的对象；草稿额外固定索引与状态。
 * Commits read fixed Git objects; LFS accepts only matching local objects, while drafts additionally bind the index and status.
 * 程序不调用内容过滤器，不下载对象，不修改索引或工作区；打开的句柄在退出前关闭。
 * The program invokes no content filters, downloads no objects, mutates neither index nor worktree, and closes opened handles before exit. */
export const deliverySourceProgram = `import os,sys,json,stat,hashlib,subprocess,base64,re
p=json.load(sys.stdin)
root=p['root']
fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
for part in filter(None,root.split('/')):
 if part in ('.','..'): raise ValueError('invalid root')
 child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
os.fchdir(fd)
def git(*args):
 r=subprocess.run(['/usr/bin/git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
 if r.returncode: raise ValueError('Git command refused')
 return r.stdout
def forbidden(path):
 return any(x in ('.git','.ssh','.aws','node_modules','__pycache__','.venv','venv','.cache') or x=='.env' or x.startswith('.env.') or x.endswith(('.pem','.key','.p12','.pfx')) for x in path.split('/'))
def regular(path):
 parts=path.split('/')
 if path.startswith('/') or not path or len(parts)>32 or any(not x or x in ('.','..') or '\\\\' in x or '\\x00' in x for x in parts): raise ValueError('invalid relative path')
 parent=os.dup(fd)
 try:
  for part in parts[:-1]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);os.close(parent);parent=child
  result=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
  info=os.fstat(result)
  if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>1073741824: os.close(result);raise ValueError('unsupported source file: '+path)
  return result,info
 finally: os.close(parent)
def data(path,oid=None,offset=None):
 process=None;expected=None;prefix=b''
 if oid:
  process=subprocess.Popen(['/usr/bin/git','cat-file','blob',oid],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);stream=process.stdout;mode=420
  prefix=stream.read(256)
  if prefix.startswith(b'version https://git-lfs.github.com/spec/v1'):
   pointer=prefix+stream.read(4097);stream.close();prefix=b''
   if process.wait(timeout=60)!=0 or len(pointer)>4096: raise ValueError('invalid Git LFS pointer')
   match=re.fullmatch(rb'version https://git-lfs.github.com/spec/v1\\noid sha256:([a-f0-9]{64})\\nsize ([0-9]+)\\n?',pointer)
   if not match: raise ValueError('unsupported Git LFS pointer')
   sha=match.group(1).decode();expected=(sha,int(match.group(2)));process=None
   common=git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip()
   if not common.startswith('/'): raise ValueError('invalid Git object directory')
   directory=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
   try:
    for part in filter(None,(common+'/lfs/objects/'+sha[:2]+'/'+sha[2:4]).split('/')):
     if part in ('.','..'): raise ValueError('invalid LFS directory')
     child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory);os.close(directory);directory=child
    source=os.open(sha,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory);info=os.fstat(source)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size!=expected[1]: os.close(source);raise ValueError('LFS object type or size mismatch')
    stream=os.fdopen(source,'rb')
   finally: os.close(directory)
 else:
  file,info=regular(path);stream=os.fdopen(file,'rb');mode=stat.S_IMODE(info.st_mode)&511
 digest=hashlib.sha256();size=0;first=b'';piece=b''
 try:
  while True:
   block=prefix or stream.read(262144);prefix=b''
   if not block: break
   if size==0: first=block[:256]
   if offset is not None and size < offset+262144 and size+len(block)>offset:
    piece+=block[max(0,offset-size):max(0,min(len(block),offset+262144-size))]
   digest.update(block);size+=len(block)
   if size>1073741824: raise ValueError('source file exceeds 1 GiB')
 finally:
  stream.close()
  if process and process.wait(timeout=60)!=0: raise ValueError('Git object read failed')
 sha=digest.hexdigest()
 if expected and (sha,size)!=expected: raise ValueError('Git LFS object digest mismatch')
 if not oid and first.startswith(b'version https://git-lfs.github.com/spec/v1'): raise ValueError('draft must contain resolved LFS bytes; refusing '+path)
 return {'path':path,'sha256':sha,'bytes':size,'mode':mode},piece
mode=p['mode'];commit=None;entries={};excluded=[];changes=[]
if mode=='commit':
 commit=git('rev-parse','--verify','--end-of-options',p['ref']+'^{commit}').decode().strip()
 for record in git('ls-tree','-rz','--full-tree',commit).split(b'\\0'):
  if not record: continue
  header,path=record.split(b'\\t',1);permissions,kind,oid=header.decode().split();path=path.decode('utf-8')
  if forbidden(path): excluded.append(path);continue
  if p['paths'] and path not in p['paths']: continue
  if kind!='blob' or permissions not in ('100644','100755'): raise ValueError('linked/submodule/special source unsupported: '+path)
  entries[path]=(oid,int(permissions,8)&511)
else:
 if not p['paths']: raise ValueError('draft requires explicit selected files')
 # The index and worktree status are versioned independently of the selected byte manifest.
 status=git('status','--porcelain=v1','-z','--untracked-files=all')
 for item in status.split(b'\\0'):
  if len(item)>=4: changes.append({'path':item[3:].decode('utf-8'),'status':item[:2].decode('ascii')})
 for path in p['paths']:
  if forbidden(path): excluded.append(path);continue
  try:
   probe,_=regular(path);os.close(probe);entries[path]=(None,None)
  except FileNotFoundError:
   if not any(c['path']==path and 'D' in c['status'] for c in changes): raise
if len(entries)>10000: raise ValueError('too many source files')
if p.get('action')=='read':
 path=p['path']
 if path not in entries: raise ValueError('source path no longer selected')
 item,piece=data(path,entries[path][0],p['offset'])
 if entries[path][1] is not None: item['mode']=entries[path][1]
 print(json.dumps({'file':item,'data':base64.b64encode(piece).decode()}))
else:
 files=[];total=0
 for path,(oid,permissions) in sorted(entries.items()):
  item,_=data(path,oid)
  if permissions is not None:item['mode']=permissions
  files.append(item);total+=item['bytes']
  if total>1073741824: raise ValueError('source snapshot exceeds 1 GiB')
 index=hashlib.sha256(git('ls-files','--stage','-z')).hexdigest() if mode=='draft' else commit
 identity=hashlib.sha256(json.dumps({'files':files,'index':index,'changes':changes},sort_keys=True,separators=(',',':')).encode()).hexdigest()
 start=p.get('start',0)
 print(json.dumps({'files':files[start:start+256],'count':len(files),'totalBytes':total,'commit':commit,'identity':identity,
  'excluded':excluded[:10000] if start==0 else [],'changes':changes[:10000] if start==0 else []}))
os.close(fd)
`;
