import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { quote } from './files.ts';
import type { ProjectIdentity } from './project-identity.ts';
import { AppError } from './model.ts';

export const notebookProviderSchema = z.enum(['jupyter', 'marimo']);
export type NotebookProvider = z.infer<typeof notebookProviderSchema>;
const root = '/var/cache/sakura/notebook-wheels';
const decimal = z.string().regex(/^[1-9][0-9]{0,19}$/);
const wheelSchema = z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.+\-]{0,240}\.whl$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(512 * 1024 * 1024),
  device: decimal, inode: decimal }).strict();
export const notebookWheelLeaseSchema = z.object({ version: z.literal(1), leaseId: z.uuid(), bootId: z.uuid(),
  provider: notebookProviderSchema, path: z.string(), device: decimal, inode: decimal,
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(wheelSchema).min(1).max(512),
}).strict().superRefine((lease, context) => {
  if (lease.path !== root + '/' + lease.leaseId || new Set(lease.files.map(file => file.name)).size !== lease.files.length ||
      lease.files.reduce((total, file) => total + file.bytes, 0) > 1024 * 1024 * 1024)
    context.addIssue({ code: 'custom', message: 'Notebook wheelhouse 原租约与路径不符' });
});
export type NotebookWheelLease = z.infer<typeof notebookWheelLeaseSchema>;
export type NotebookWheelRequest = { leaseId: string; bootId: string; provider: NotebookProvider };
export const notebookWheelRequest = (bootId: string, provider: NotebookProvider): NotebookWheelRequest => ({
  leaseId: randomUUID(), bootId: z.uuid().parse(bootId), provider: notebookProviderSchema.parse(provider),
});

/** Only bounded administrator-owned wheel data is inspected, never imported. */
const verifier = `import hashlib,json,os,re,stat
def refuse(): raise ValueError('notebook wheelhouse ownership changed')
def trusted(info,directory=False):
 if info.st_uid!=0 or info.st_gid!=0 or info.st_mode&0o022 or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)): refuse()
 if not directory and (info.st_nlink!=1 or info.st_mode&0o222): refuse()
def pinned_file(parent,name,expected=None,limit=512*1024*1024):
 fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=parent)
 try:
  before=os.fstat(fd);trusted(before)
  if before.st_size<1 or before.st_size>limit: refuse()
  if expected and (str(before.st_dev)!=expected['device'] or str(before.st_ino)!=expected['inode'] or before.st_size!=expected['bytes']): refuse()
  h=hashlib.sha256();count=0;parts=[]
  while True:
   data=os.read(fd,65536)
   if not data:break
   count+=len(data)
   if count>limit:refuse()
   h.update(data)
   if limit<=262144:parts.append(data)
  after=os.fstat(fd)
  if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) or count!=before.st_size:refuse()
  digest=h.hexdigest()
  if expected and digest!=expected['sha256']:refuse()
  return before,digest,b''.join(parts)
 finally:os.close(fd)
def verified(lease,with_manifest=False):
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  trusted(os.fstat(fd),True)
  for part in lease['path'].split('/')[1:]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
   os.close(fd);fd=child;trusted(os.fstat(fd),True)
  info=os.fstat(fd)
  if str(info.st_dev)!=lease['device'] or str(info.st_ino)!=lease['inode'] or info.st_mode&0o222:refuse()
  _,digest,data=pinned_file(fd,'.manifest.json',limit=262144)
  if digest!=lease['manifestSha256']:refuse()
  manifest=json.loads(data);fields={'version','leaseId','bootId','provider','path','device','inode','files'}
  if not isinstance(manifest,dict) or set(manifest)!=fields or any(manifest[key]!=lease[key] for key in fields-{'files'}):refuse()
  files=manifest['files']
  if not isinstance(files,list) or not 1<=len(files)<=512:refuse()
  for item in files:
   if not isinstance(item,dict) or set(item)!={'name','sha256','bytes','device','inode'}:refuse()
   if not isinstance(item['name'],str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+\\-]{0,240}\\.whl',item['name']) or not re.fullmatch(r'[a-f0-9]{64}',item['sha256']):refuse()
   if type(item['bytes'])!=int or not 1<=item['bytes']<=512*1024*1024 or any(not isinstance(item[key],str) or not re.fullmatch(r'[1-9][0-9]{0,19}',item[key]) for key in ['device','inode']):refuse()
  if len({item['name'] for item in files})!=len(files) or sum(item['bytes'] for item in files)>1024*1024*1024:refuse()
  if 'files' in lease and lease['files']!=files:refuse()
  names=os.listdir(fd)
  if len(names)>513 or set(names)!={item['name'] for item in files}|{'.manifest.json'}:refuse()
  for item in files:pinned_file(fd,item['name'],item)
  return (fd,manifest) if with_manifest else fd
 except:
  os.close(fd);raise
`;

/** Fixed administrator environment, package names and public index; no project configuration. */
export function notebookWheelhouseCommand(operation: 'download' | 'cleanup', request:
  ReturnType<typeof notebookWheelRequest> | NotebookWheelLease) {
  let value;
  if (operation === 'cleanup') {
    // The immutable manifest digest binds the complete exact file set without
    // expanding one privileged argv past the kernel's single-argument bound.
    const { files: _files, ...pin } = notebookWheelLeaseSchema.parse(request);
    value = pin;
  } else value = z.object({ leaseId: z.uuid(), bootId: z.uuid(), provider: notebookProviderSchema }).strict().parse(request);
  const source = verifier + `
request=json.loads(${JSON.stringify(JSON.stringify(value))})
if os.geteuid()!=0 or open('/proc/sys/kernel/random/boot_id').read().strip()!=request['bootId']:refuse()
operation=${JSON.stringify(operation)}
if operation=='download':
 import subprocess,sys
 path='/var/cache/sakura/notebook-wheels/'+request['leaseId']
 for folder in ['/var','/var/cache','/var/cache/sakura','/var/cache/sakura/notebook-wheels']:
  if folder in ['/var/cache/sakura','/var/cache/sakura/notebook-wheels']:
   try:os.mkdir(folder,0o755)
   except FileExistsError:pass
  trusted(os.lstat(folder),True)
 os.mkdir(path,0o700)
 package={'jupyter':'jupyterlab','marimo':'marimo'}[request['provider']]
 result=subprocess.run(['/usr/bin/python3','-I','-m','pip','--isolated','download','--disable-pip-version-check','--no-input','--no-cache-dir','--only-binary=:all:','--index-url','https://pypi.org/simple','--dest',path,'pip',package],stdout=sys.stderr,stderr=sys.stderr,stdin=subprocess.DEVNULL,cwd='/',env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','USER':'root','LOGNAME':'root','LANG':'C','LC_ALL':'C','PIP_CONFIG_FILE':'/dev/null'})
 if result.returncode:raise RuntimeError('notebook administrator wheel download failed; original cache retained: '+request['leaseId'])
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(fd);trusted(info,True);names=sorted(os.listdir(fd));files=[];total=0
  if not 1<=len(names)<=512:refuse()
  for name in names:
   if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+\\-]{0,240}\\.whl',name):refuse()
   file=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=fd)
   try:
    original=os.fstat(file)
    if not stat.S_ISREG(original.st_mode) or original.st_uid!=0 or original.st_gid!=0 or original.st_nlink!=1:refuse()
    os.fchmod(file,0o444)
   finally:os.close(file)
   original,digest,_=pinned_file(fd,name);total+=original.st_size
   if total>1024*1024*1024:refuse()
   files.append({'name':name,'sha256':digest,'bytes':original.st_size,'device':str(original.st_dev),'inode':str(original.st_ino)})
  lease={'version':1,**request,'path':path,'device':str(info.st_dev),'inode':str(info.st_ino),'files':files}
  data=json.dumps(lease,sort_keys=True,separators=(',',':')).encode();manifest=os.open('.manifest.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o444,dir_fd=fd)
  os.fchmod(manifest,0o444)
  with os.fdopen(manifest,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
  os.fchmod(fd,0o555);os.fsync(fd);lease['manifestSha256']=hashlib.sha256(data).hexdigest()
 finally:os.close(fd)
 fd=verified(lease);os.close(fd);print(json.dumps(lease))
else:
 fd,manifest=verified(request,True)
 parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  trusted(os.fstat(parent),True)
  for part in request['path'].split('/')[1:-1]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
   os.close(parent);parent=child;trusted(os.fstat(parent),True)
  os.fchmod(fd,0o700)
  for item in manifest['files']:os.unlink(item['name'],dir_fd=fd)
  os.unlink('.manifest.json',dir_fd=fd);os.fsync(fd)
  info=os.stat(request['leaseId'],dir_fd=parent,follow_symlinks=False);trusted(info,True)
  if str(info.st_dev)!=request['device'] or str(info.st_ino)!=request['inode']:refuse()
  os.rmdir(request['leaseId'],dir_fd=parent)
  try:os.stat(request['leaseId'],dir_fd=parent,follow_symlinks=False)
  except FileNotFoundError:pass
  else:refuse()
  os.fsync(parent)
 finally:os.close(fd);os.close(parent)
 print(json.dumps({'cleaned':True,'leaseId':request['leaseId']}))
`;
  const command = '# SAKURA_NOTEBOOK_WHEELS_' + operation.toUpperCase() + '\n' +
    'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ USER=root LOGNAME=root LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/null /usr/bin/python3 -I -S -c ' + quote(source);
  if (Buffer.byteLength(command, 'utf8') > 16384) throw new AppError('Notebook 固定管理员命令超过运输边界', 413, 'NOTEBOOK_PREPARE_FAILED');
  return command;
}

/** The verifier and every project path run only after the native UID/GID drop. */
export function notebookInstallExecution(identity: ProjectIdentity, lease: NotebookWheelLease) {
  lease = notebookWheelLeaseSchema.parse(lease);
  const pip = lease.files.filter(file => /^pip-[0-9][A-Za-z0-9_.+\-]*\.whl$/.test(file.name));
  if (pip.length !== 1) throw new AppError('Notebook 缺少唯一已核对 pip wheel', 409, 'NOTEBOOK_PREPARE_FAILED');
  const venv = identity.directory.replace(/\/$/, '') + '/.sakura/notebooks/' + lease.provider + '/venv';
  const marker = { version: 1, provider: lease.provider, registryId: identity.registryId, identityId: identity.identityId,
    revision: identity.revision, uid: identity.uid, gid: identity.gid,
    directoryDevice: identity.directoryDevice, directoryInode: identity.directoryInode };
  // The immutable manifest digest binds all file metadata; carrying the small
  // pin lets a 512-wheel cache fit ABI1 without expanding the protected frame.
  const { files: _files, ...pin } = lease;
  const check = verifier + `\nlease=json.loads(${JSON.stringify(JSON.stringify(pin))})\nfd=verified(lease);os.close(fd)`;
  const bootstrap = `import runpy,sys\nsys.path.insert(0,${JSON.stringify(lease.path + '/' + pip[0].name)})\n` +
    `sys.argv=['pip','--isolated','install','--disable-pip-version-check','--no-input','--no-cache-dir','--no-index','--only-binary=:all:',${JSON.stringify('--find-links=' + lease.path)},'pip']\n` +
    `runpy.run_module('pip',run_name='__main__',alter_sys=True)`;
  const record = `import json,os\nvalue=json.loads(${JSON.stringify(JSON.stringify(marker))})\n` +
    `path=${JSON.stringify(venv + '/../identity.json')}\n` +
    `fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)\n` +
    `with os.fdopen(fd,'w') as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())`;
  return 'set -eu\numask 077\n' +
    '/usr/bin/python3 -I -S -c ' + quote(check) + '\n' +
    '/usr/bin/python3 -I -m venv --without-pip ' + quote(venv) + '\n' +
    quote(venv + '/bin/python') + ' -I -c ' + quote(bootstrap) + '\n' +
    quote(venv + '/bin/python') + ' -I -m pip --isolated install --disable-pip-version-check --no-input --no-cache-dir --no-index --only-binary=:all: --find-links=' +
      quote(lease.path) + ' ' + (lease.provider === 'jupyter' ? 'jupyterlab' : 'marimo') + '\n' +
    'test -x ' + quote(venv + '/bin/' + lease.provider) + '\n' +
    '/usr/bin/python3 -I -S -c ' + quote(record);
}

/** Read project-generated metadata without running its Python, imports or executable. */
export function notebookInstalledCommand(identity: ProjectIdentity, provider: NotebookProvider) {
  const expected = { version: 1, provider, registryId: identity.registryId, identityId: identity.identityId,
    revision: identity.revision, uid: identity.uid, gid: identity.gid,
    directoryDevice: identity.directoryDevice, directoryInode: identity.directoryInode };
  const source = `import json,os,stat
expected=json.loads(${JSON.stringify(JSON.stringify(expected))});directory=${JSON.stringify(identity.directory)}
fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
try:
 for part in directory.split('/')[1:]:
  next=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=next
 info=os.fstat(fd)
 if info.st_uid!=expected['uid'] or str(info.st_dev)!=expected['directoryDevice'] or str(info.st_ino)!=expected['directoryInode']:raise ValueError('notebook directory changed')
 for part in ['.sakura','notebooks',expected['provider']]:
  next=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=next
  if os.fstat(fd).st_uid!=expected['uid']:raise ValueError('notebook environment ownership changed')
 marker=os.open('identity.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=fd)
 with os.fdopen(marker,'rb') as stream:
  info=os.fstat(stream.fileno())
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=expected['uid'] or info.st_gid!=expected['gid'] or info.st_nlink!=1 or info.st_size>8192:raise ValueError('notebook marker changed')
  if json.loads(stream.read(8193))!=expected:raise ValueError('notebook account revision changed')
 for part in ['venv','bin']:
  next=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=next
 info=os.stat(expected['provider'],dir_fd=fd,follow_symlinks=False)
 ready=stat.S_ISREG(info.st_mode) and info.st_uid==expected['uid'] and info.st_gid==expected['gid'] and bool(info.st_mode&0o111)
 print(json.dumps({'installed':ready}))
finally:os.close(fd)
`;
  return '# SAKURA_NOTEBOOK_INSTALLED\n/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(source);
}
