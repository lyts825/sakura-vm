import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentitySources } from './project-identity.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { ProjectMainScope, ProjectServiceScopes } from './project-service-scope.ts';
import { legacyMainStatus } from './project-main.ts';
import { projectSshBusyScript } from './project-ssh.ts';
import { privateDockerPaths, privateDockerStatus } from './private-docker.ts';
import { terminalSessionPrefix } from '../shared/terminal-scope.ts';
import { assertProjectTerminalsStopped } from './project-terminals.ts';
import { projectVersion, type Project, type Workspaces } from './workspaces.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/),
  decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const guestPath = z
  .string()
  .min(1)
  .max(1023)
  .refine(
    (value) =>
      value.startsWith('/') &&
      !/[\x00-\x1f\x7f]/.test(value) &&
      value
        .split('/')
        .slice(1)
        .every((part) => part && part !== '.' && part !== '..'),
  );
export function migrationDirectoryAllowed(directory: string) {
  return (
    guestPath.safeParse(directory).success &&
    (directory === '/workspace' ||
      directory.startsWith('/workspace/') ||
      directory.startsWith('/srv/projects/') ||
      directory.startsWith('/opt/projects/'))
  );
}
const entrySchema = z
  .object({
    path: z.string().max(1023),
    kind: z.enum(['file', 'directory']),
    device: decimal,
    inode: decimal,
    mountId: decimal,
    filesystemId: decimal,
    uid: z.number().int().nonnegative(),
    gid: z.number().int().nonnegative(),
    mode: z.number().int().min(0).max(4095),
    links: z.number().int().min(1),
    size: z.number().int().nonnegative(),
    mtimeNs: decimal,
    ctimeNs: decimal,
    sha256: digest.nullable(),
    targetMode: z.number().int().min(0).max(511),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (
      (entry.path !== '.' &&
        (!entry.path ||
          entry.path.startsWith('/') ||
          entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
          /[\x00-\x1f\x7f]/.test(entry.path))) ||
      (entry.kind === 'file' &&
        (entry.links !== 1 || !entry.sha256 || entry.targetMode !== (0o600 | (entry.mode & 0o100)))) ||
      (entry.kind === 'directory' && (entry.sha256 !== null || entry.targetMode !== 0o700))
    )
      ctx.addIssue({ code: 'custom', message: '目录计划条目不完整' });
  });
const proposalSchema = z
  .object({
    version: z.literal(1),
    planId: z.uuid(),
    createdAt: z.iso.datetime(),
    vmId: z.uuid(),
    projectId: projectIdSchema,
    bootId: z.uuid(),
    identity: projectIdentitySchema,
    directory: guestPath,
    networkIsolation: z.enum(['host', 'private']),
    configSha256: digest,
    projectsSha256: digest,
    policy: z.literal('private-owner-v1'),
    entries: z.array(entrySchema).min(1).max(2000),
    summary: z
      .object({
        files: z.number().int().nonnegative(),
        directories: z.number().int().min(1),
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      !migrationDirectoryAllowed(plan.directory) ||
      plan.identity.projectId !== plan.projectId ||
      plan.identity.homeInode === '0' ||
      plan.entries[0].path !== '.' ||
      plan.entries[0].kind !== 'directory' ||
      new Set(plan.entries.map((entry) => entry.path)).size !== plan.entries.length ||
      plan.entries.some(
        (entry) =>
          entry.device !== plan.entries[0].device ||
          entry.mountId !== plan.entries[0].mountId ||
          entry.filesystemId !== plan.entries[0].filesystemId ||
          ![0, plan.identity.uid].includes(entry.uid) ||
          (entry.mode & 0o022) !== 0,
      ) ||
      plan.summary.files !== plan.entries.filter((entry) => entry.kind === 'file').length ||
      plan.summary.directories !== plan.entries.filter((entry) => entry.kind === 'directory').length ||
      plan.summary.bytes !==
        plan.entries.filter((entry) => entry.kind === 'file').reduce((sum, entry) => sum + entry.size, 0)
    )
      ctx.addIssue({ code: 'custom', message: '目录计划边界不完整' });
    if (
      plan.directory === plan.identity.directory &&
      (plan.entries[0].device !== plan.identity.directoryDevice ||
        plan.entries[0].inode !== plan.identity.directoryInode)
    )
      ctx.addIssue({ code: 'custom', message: '目录 inode 不属于固定身份' });
  });
export const directoryMigrationPlanSchema = z
  .object({
    version: z.literal(1),
    proposal: proposalSchema,
    sha256: digest,
    state: z.enum(['preview', 'applying', 'failed', 'directory-applied', 'applied']),
    completed: z.array(z.string()).max(2000),
    attempt: z.string().nullable(),
    lastError: z
      .object({ code: z.string().regex(/^[A-Z_]{1,80}$/), path: z.string().max(1023).optional() })
      .strict()
      .nullable(),
    activatedIdentity: projectIdentitySchema.nullable(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      migrationPlanDigest(plan.proposal) !== plan.sha256 ||
      new Set(plan.completed).size !== plan.completed.length ||
      plan.completed.some((path) => !plan.proposal.entries.some((entry) => entry.path === path)) ||
      (plan.attempt !== null && !plan.proposal.entries.some((entry) => entry.path === plan.attempt)) ||
      (['directory-applied', 'applied'].includes(plan.state) &&
        plan.completed.length !== plan.proposal.entries.length) ||
      (plan.state === 'applied' && (!plan.activatedIdentity || plan.activatedIdentity.phase !== 'active'))
    )
      ctx.addIssue({ code: 'custom', message: '目录迁移回执不完整' });
  });
export type DirectoryMigrationPlan = z.infer<typeof directoryMigrationPlanSchema>;
export const directoryMigrationApplySchema = z
  .object({
    action: z.literal('apply'),
    version: z.literal(1),
    planId: z.uuid(),
    sha256: digest,
    reviewed: z.literal(true),
  })
  .strict();
export const directoryMigrationPreviewSchema = z
  .object({ action: z.literal('preview'), version: z.literal(1) })
  .strict();
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, content]) => [key, canonical(content)]),
        )
      : value;
export function migrationPlanDigest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Fixed root helper. The caller supplies data through bounded SSH stdin, never Python code or a shell traversal. */
export const directoryMigrationHelper = String.raw`import datetime,errno,hashlib,importlib.util,json,os,re,resource,stat,sys,uuid
ROOT='/var/lib/sakura/project-directory-migrations'
FD_LIMIT=resource.getrlimit(resource.RLIMIT_NOFILE)[0]
MAX_ENTRIES=2000 if FD_LIMIT==resource.RLIM_INFINITY else min(2000,max(1,FD_LIMIT-64))
MAX_BYTES=268435456;MAX_RECEIPT=524288
class Refusal(Exception):
 def __init__(self,code,path=None):self.code=code;self.path=path
def fail(code,path=None):raise Refusal(code,path)
def cleanpath(path):
 if not isinstance(path,str) or not path.startswith('/') or len(path.encode())>1023 or any(ord(c)<32 or ord(c)==127 for c in path) or any(not p or p in ('.','..') for p in path.split('/')[1:]):fail('DIRECTORY_PATH')
 return path
def allowed(path):
 cleanpath(path)
 if not(path=='/workspace' or path.startswith('/workspace/') or path.startswith('/srv/projects/') or path.startswith('/opt/projects/')):fail('DIRECTORY_NOT_ALLOWED')
def canon(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(value):return hashlib.sha256(canon(value)).hexdigest()
def pairs(items):
 result={}
 for key,value in items:
  if key in result:fail('RECORD_DUPLICATE_KEY')
  result[key]=value
 return result
def record_read(core,path,missing=False,limit=MAX_RECEIPT):
 raw=core.read(path,limit,missing)
 if raw is None:return None
 try:return json.loads(raw,object_pairs_hook=pairs)
 except (ValueError,UnicodeError):fail('RECORD_JSON')
def trusted(info,directory=False):
 if not(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or info.st_uid!=0 or info.st_mode&0o022 or (not directory and info.st_nlink!=1):fail('UNTRUSTED_RECORD')
def mount_id(fd):
 for line in open('/proc/self/fdinfo/'+str(fd)):
  if line.startswith('mnt_id:'):return line.split()[1]
 fail('MOUNT_UNCONFIRMED')
def parent_fd(path,uid,gid,migration=False):
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  trusted(os.fstat(fd),True)
  boundary='/' if path=='/workspace' or path.startswith('/workspace/') else '/srv/projects' if path.startswith('/srv/projects/') else '/opt/projects'
  fixed=mount_id(fd) if migration and boundary=='/' else None;walked=''
  for part in path.split('/')[1:-1]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=child
   info=os.fstat(fd);trusted(info,True)
   if migration:
    walked+='/'+part;current=mount_id(fd)
    if walked==boundary:fixed=current
    elif fixed is not None and current!=fixed:fail('CROSS_MOUNT','.')
   mode=stat.S_IMODE(info.st_mode)
   if not(mode&(0o010 if info.st_gid==gid else 0o001)):fail('PARENT_TRAVERSAL_NOT_GRANTED')
  return fd
 except BaseException:os.close(fd);raise
def no_extra_permissions(fd,path):
 names=os.listxattr(fd)
 if any(name in names for name in ('system.posix_acl_access','system.posix_acl_default','security.capability')):fail('EXTRA_PERMISSIONS',path)
def overlap(a,b):return a==b or a.startswith(b.rstrip('/')+'/') or b.startswith(a.rstrip('/')+'/')
def exact_identity(actual,expected):
 if not isinstance(expected,dict) or set(actual)!=set(expected) or any(actual[k]!=expected[k] for k in actual):fail('IDENTITY_CHANGED')
def same_account(actual,old):
 return all(actual[k]==old[k] for k in ('registryId','identityId','projectId','account','uid','gid','home','homeDevice','homeInode'))
def stable_binding(actual,old):
 return same_account(actual,old) and all(actual[k]==old[k] for k in ('revision','directory','directoryDevice','directoryInode','networkIsolation'))
def account_for_plan(value,proposal,state):
 old=proposal['identity']
 if stable_binding(value,old):return
 revision=old['revision']+(0 if old['directory']==proposal['directory'] and old['networkIsolation']==proposal['networkIsolation'] else 1)
 root=proposal['entries'][0]
 if state not in ('directory-applied','applied') or not same_account(value,old) or value['revision']!=revision or value['directory']!=proposal['directory'] or value['networkIsolation']!=proposal['networkIsolation'] or value['directoryDevice']!=root['device'] or value['directoryInode']!=root['inode']:fail('IDENTITY_CHANGED')
def tree(path,value):
 allowed(path);uid=value['uid'];parent=parent_fd(path,uid,value['gid'],True);fds={};entries=[];total=0
 try:
  fd=os.open(path.rsplit('/',1)[1],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent);fds['.']=fd
  root=os.fstat(fd);mount=mount_id(fd)
  if mount_id(parent)!=mount:fail('CROSS_MOUNT','.')
  def visit(relative,descriptor):
   nonlocal total
   info=os.fstat(descriptor);mode=stat.S_IMODE(info.st_mode)
   kind='directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else None
   if not kind:fail('FILE_TYPE',relative)
   if info.st_dev!=root.st_dev or mount_id(descriptor)!=mount:fail('CROSS_MOUNT',relative)
   if info.st_uid not in (0,uid) or mode&0o022:fail('FOREIGN_OWNER_OR_WRITER',relative)
   if kind=='file' and info.st_nlink!=1:fail('HARDLINK',relative)
   no_extra_permissions(descriptor,relative)
   if len(entries)>=MAX_ENTRIES:fail('PLAN_ENTRY_LIMIT')
   content=None
   if kind=='file':
    total+=info.st_size
    if total>MAX_BYTES:fail('PLAN_BYTE_LIMIT')
    hash=hashlib.sha256();os.lseek(descriptor,0,os.SEEK_SET)
    while True:
     data=os.read(descriptor,65536)
     if not data:break
     hash.update(data)
    after=os.fstat(descriptor)
    if (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)!=(info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns):fail('TREE_CHANGED',relative)
    content=hash.hexdigest()
   entries.append({'path':relative,'kind':kind,'device':str(info.st_dev),'inode':str(info.st_ino),'mountId':mount,'filesystemId':str(os.fstatvfs(descriptor).f_fsid & ((1<<64)-1)),'uid':info.st_uid,'gid':info.st_gid,'mode':mode,'links':info.st_nlink,'size':info.st_size,'mtimeNs':str(info.st_mtime_ns),'ctimeNs':str(info.st_ctime_ns),'sha256':content,'targetMode':0o700 if kind=='directory' else 0o600|(mode&0o100)})
   if kind=='directory':
    for name in sorted(os.listdir(descriptor)):
     childpath=name if relative=='.' else relative+'/'+name
     if len(childpath.encode())>1023 or any(ord(c)<32 or ord(c)==127 for c in name):fail('ENTRY_PATH',relative)
     before=os.stat(name,dir_fd=descriptor,follow_symlinks=False)
     if stat.S_ISLNK(before.st_mode):fail('SYMLINK',childpath)
     if not(stat.S_ISREG(before.st_mode) or stat.S_ISDIR(before.st_mode)):fail('FILE_TYPE',childpath)
     if len(fds)>=MAX_ENTRIES:fail('PLAN_ENTRY_LIMIT')
     child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=descriptor);fds[childpath]=child
     actual=os.fstat(child)
     if (actual.st_dev,actual.st_ino,actual.st_mode)!=(before.st_dev,before.st_ino,before.st_mode):fail('TREE_CHANGED',childpath)
     visit(childpath,child)
    if os.fstat(descriptor).st_mtime_ns!=info.st_mtime_ns:fail('TREE_CHANGED',relative)
  visit('.',fd)
  return entries,fds,parent
 except BaseException:
  for fd in fds.values():os.close(fd)
  os.close(parent);raise
def close_tree(fds,parent):
 for fd in fds.values():os.close(fd)
 os.close(parent)
def physical(fd):
 info=os.fstat(fd)
 return (str(info.st_dev),str(info.st_ino),str(os.fstatvfs(fd).f_fsid & ((1<<64)-1)))
def directory_objects(path):
 if path!='/':cleanpath(path)
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);ancestors={physical(fd)}
 try:
  for part in path.split('/')[1:] if path!='/' else []:
   try:child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
   except FileNotFoundError:return fd,ancestors,False
   os.close(fd);fd=child;ancestors.add(physical(fd))
  return fd,ancestors,True
 except BaseException:os.close(fd);raise
def physical_overlap(path,others,fds=None):
 held=[];seen=set()
 limit=2000 if FD_LIMIT==resource.RLIM_INFINITY else max(0,FD_LIMIT-len(fds or {})-32)
 try:
  target,ancestors,complete=directory_objects(path)
  try:
   if not complete or (fds is not None and physical(target)!=physical(fds['.'])):fail('TREE_CHANGED','.')
   objects={physical(fd) for fd in fds.values()} if fds is not None else {physical(target)}
  finally:os.close(target)
  for other in others:
   otherpath=other['directory']
   try:fd,_,complete=directory_objects(otherpath)
   except (OSError,Refusal):fail('OTHER_DIRECTORY_UNCONFIRMED',otherpath)
   try:
    key=physical(fd);binding=other.get('binding')
    if binding is not None:
     info=os.fstat(fd)
     if not complete or (str(info.st_dev),str(info.st_ino))!=(binding['directoryDevice'],binding['directoryInode']):fail('OTHER_DIRECTORY_UNCONFIRMED',otherpath)
    if key in objects or (complete and key in ancestors):fail('PHYSICAL_OVERLAP',otherpath)
    if key in seen:continue
    if len(held)>=limit:fail('PLAN_FD_LIMIT')
    held.append(fd);seen.add(key);fd=None
   finally:
    if fd is not None:os.close(fd)
  return held
 except BaseException:
  for fd in held:os.close(fd)
  raise
def revalidate_paths(fds,parent,path):
 for relative,fd in fds.items():
  if relative=='.':ancestor=parent;name=path.rsplit('/',1)[1]
  else:
   ancestor=fds[relative.rsplit('/',1)[0] if '/' in relative else '.'];name=relative.rsplit('/',1)[-1]
  a=os.fstat(fd);b=os.stat(name,dir_fd=ancestor,follow_symlinks=False)
  if (a.st_dev,a.st_ino,a.st_mode)!=(b.st_dev,b.st_ino,b.st_mode):fail('TREE_CHANGED',relative)
def receipt_path(project,plan):return ROOT+'/'+project+'/'+plan+'.json'
def receipt_room(record):
 proposal=record['proposal'];old=proposal['identity'];root=proposal['entries'][0]
 revision=old['revision']+(0 if old['directory']==proposal['directory'] and old['networkIsolation']==proposal['networkIsolation'] else 1)
 target=dict(old,phase='active',revision=revision,directory=proposal['directory'],networkIsolation=proposal['networkIsolation'],directoryDevice=root['device'],directoryInode=root['inode'])
 paths=[entry['path'] for entry in proposal['entries']];longest=max(paths,key=lambda path:len(canon(path)))
 # Reserve the whole retry journal before any chown, including its largest failure and final binding.
 # Revalidation can encounter a new unplanned path; reserve its maximum escaped UTF-8 length too.
 upper=dict(record,state='directory-applied',completed=paths,attempt=longest,lastError={'code':'X'*80,'path':'\\'*1023},activatedIdentity=target)
 return len(canon(upper))<=MAX_RECEIPT
def validate_receipt(record,plan=None,sha=None):
 if not isinstance(record,dict) or set(record)!={'version','proposal','sha256','state','completed','attempt','lastError','activatedIdentity'} or record['version']!=1 or digest(record['proposal'])!=record['sha256'] or record['state'] not in ('preview','applying','failed','directory-applied','applied'):fail('PLAN_CORRUPT')
 if plan is not None and (record['proposal']['planId']!=plan or record['sha256']!=sha):fail('PLAN_CHANGED')
 paths=[entry['path'] for entry in record['proposal']['entries']]
 if len(set(paths))!=len(paths) or not isinstance(record['completed'],list) or len(set(record['completed']))!=len(record['completed']) or any(p not in paths for p in record['completed']) or (record['attempt'] is not None and record['attempt'] not in paths):fail('PLAN_CORRUPT')
 if record['state'] in ('directory-applied','applied') and (len(record['completed'])!=len(paths) or record['attempt'] is not None):fail('PLAN_CORRUPT')
 return record
def verify_tree(record,current,boot):
 proposal=record['proposal'];expected=proposal['entries'];uid=proposal['identity']['uid'];gid=proposal['identity']['gid']
 if len(current)!=len(expected):fail('TREE_CHANGED')
 for before,after in zip(expected,current):
  path=before['path']
  if any(before[key]!=after[key] for key in ('path','kind','device','inode','filesystemId','links','size','mtimeNs','sha256')) or (proposal['bootId']==boot and before['mountId']!=after['mountId']):fail('TREE_CHANGED',path)
  original=(before['uid'],before['gid'],before['mode']);now=(after['uid'],after['gid'],after['mode']);target=(uid,gid,before['targetMode'])
  if path in record['completed']:
   if now!=target:fail('PERMISSIONS_CHANGED',path)
  elif path==record['attempt']:
   intermediates={original,(uid,gid,before['mode']),(uid,gid,before['mode']&~0o6000),target}
   if now not in intermediates:fail('PERMISSIONS_CHANGED',path)
  elif now!=original or before['ctimeNs']!=after['ctimeNs']:fail('PERMISSIONS_CHANGED',path)
def current_record(core,project):
 pointer=record_read(core,ROOT+'/'+project+'/current.json',True)
 if pointer is None:return None
 if not isinstance(pointer,dict) or set(pointer)!={'version','planId','sha256'} or pointer['version']!=1:fail('PLAN_CORRUPT')
 core.identifier(pointer['planId'],core.UUID,'PLAN_ID')
 return validate_receipt(record_read(core,receipt_path(project,pointer['planId'])),pointer['planId'],pointer['sha256'])
def latch(core,record,value):
 proposal=record['proposal']
 core.json_write(ROOT+'/'+proposal['projectId']+'/latch.json',{'version':1,'projectId':proposal['projectId'],'planId':proposal['planId'],'sha256':record['sha256'],'phase':record['state'],'identity':value})
def validate_latch(core,marker,value):
 if marker is None:return
 if not isinstance(marker,dict) or set(marker)!={'version','projectId','planId','sha256','phase','identity'} or type(marker['version']) is not int or marker['version']!=1 or marker['projectId']!=value['projectId'] or marker['phase'] not in ('applying','failed','directory-applied','applied') or not isinstance(marker['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',marker['sha256']):fail('LATCH_CHANGED')
 core.identifier(marker['planId'],core.UUID,'LATCH_CHANGED')
 old=marker['identity']
 if not isinstance(old,dict) or set(old)!=set(value) or not same_account(old,value) or type(old['version']) is not int or old['version']!=1 or old['phase'] not in ('active','intent') or type(old['revision']) is not int or old['revision']<1 or old['networkIsolation'] not in ('host','private'):fail('LATCH_CHANGED')
 cleanpath(old['directory'])
 if any(not isinstance(old[key],str) or not re.fullmatch('0|[1-9][0-9]*',old[key]) for key in ('directoryDevice','directoryInode','homeDevice','homeInode')):fail('LATCH_CHANGED')
 if marker['phase']=='applied' and old['phase']!='active':fail('LATCH_CHANGED')
def main():
 if os.geteuid()!=0:fail('ROOT_REQUIRED')
 data=sys.stdin.buffer.read(131073)
 if len(data)>131072:fail('REQUEST_LIMIT')
 request=json.loads(data,object_pairs_hook=pairs)
 fields={'action','version','build','controllerSha256','identity','directory','networkIsolation','configSha256','projects','projectsSha256','vmId','planId','sha256'}
 if not isinstance(request,dict) or set(request)-fields or request.get('version')!=1 or request.get('action') not in ('preview','apply','confirm'):fail('REQUEST_SCHEMA')
 build=request.get('build')
 if not isinstance(build,str) or not re.fullmatch('[a-f0-9]{64}',build):fail('BUILD_INVALID')
 controller='/usr/local/lib/sakura-project-identity/'+build+'/controller.py'
 parent=parent_fd(controller,0,0)
 try:
  fd=os.open('controller.py',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
  try:
   trusted(os.fstat(fd));source=os.read(fd,262145)
   if len(source)>262144 or hashlib.sha256(source).hexdigest()!=request.get('controllerSha256'):fail('SOURCE_CHANGED')
  finally:os.close(fd)
 finally:os.close(parent)
 module=importlib.util.module_from_spec(importlib.util.spec_from_file_location('sakura_migration_identity',controller))
 exec(compile(source,controller,'exec'),module.__dict__)
 if module.sources()!=build:fail('SOURCE_CHANGED')
 core=module;lock=core.initialize();record=None
 try:
  value=core.binding_read(request['identity']['projectId']);store=core.registry()
  core.reservation_check(value,store);core.expected(value,{'expected':{k:request['identity'][k] for k in ('registryId','identityId','revision')}})
  exact_identity(value,request['identity']);core.account_check(value);core.home_check(value)
  if value['homeInode']=='0' or not core.same(core.project_directory(value['directory']),value,'directory'):fail('IDENTITY_CHANGED')
  project=value['projectId'];path=request['directory'];allowed(path)
  boot=open('/proc/sys/kernel/random/boot_id').read().strip();core.identifier(boot,core.UUID,'BOOT_ID')
  for run in core.runs_for(value):
   if run['bootId']!=boot:continue
   descriptor=core.cgroup_fd(run)
   try:
    if run['phase']=='active' or (descriptor is not None and core.populated(descriptor)):fail('IDENTITY_RUNS_MUST_STOP')
   finally:
    if descriptor is not None:os.close(descriptor)
  projects=request['projects']
  if digest(projects)!=request['projectsSha256']:fail('PROJECTS_CHANGED')
  others=[]
  for other in projects:
   if other['projectId']==project:continue
   if overlap(path,other['directory']):fail('PROJECT_DIRECTORY_OVERLAP',other['directory'])
   others.append({'directory':other['directory']})
  for reserved in store['reserved'].values():
   if reserved['projectId']==project:continue
   other=core.binding_read(reserved['projectId'])
   core.reservation_check(other,store)
   if overlap(path,other['directory']):fail('IDENTITY_DIRECTORY_OVERLAP',other['directory'])
   others.append({'directory':other['directory'],'binding':other})
  # Classify actual aliases before the separate mount-policy refusal; every mutation rechecks the full held tree below.
  preflight=physical_overlap(path,others)
  for fd in preflight:os.close(fd)
  core.make_directory(ROOT)
  core.make_directory(ROOT+'/'+project)
  marker=record_read(core,ROOT+'/'+project+'/latch.json',True)
  validate_latch(core,marker,value)
  if request['action']=='preview':
   old=current_record(core,project)
   if old and ((old['state']!='applied' and (old['completed'] or old['attempt'])) or (marker is not None and marker['phase']!='applied')):
    if marker is not None and (marker['planId']!=old['proposal']['planId'] or marker['sha256']!=old['sha256']):fail('LATCH_CHANGED')
    account_for_plan(value,old['proposal'],old['state'])
    if old['proposal']['configSha256']!=request['configSha256'] or old['proposal']['projectsSha256']!=request['projectsSha256']:fail('PENDING_PLAN_REQUIRES_ORIGINAL_CONFIG')
    # A durable receipt is not a released latch. Keep explicit retry available after a lost final write.
    if old['state']=='applied' and marker is not None and marker['phase']!='applied':old['state']='directory-applied'
    return old
   if marker is not None and marker['phase']!='applied':fail('PENDING_PLAN_UNCONFIRMED')
   entries,fds,parent=tree(path,value)
   held=[]
   try:
    held=physical_overlap(path,others,fds);revalidate_paths(fds,parent,path)
   finally:
    for fd in held:os.close(fd)
    close_tree(fds,parent)
   proposal={'version':1,'planId':str(uuid.uuid4()),'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'vmId':request['vmId'],'projectId':project,'bootId':boot,'identity':value,'directory':path,'networkIsolation':request['networkIsolation'],'configSha256':request['configSha256'],'projectsSha256':request['projectsSha256'],'policy':'private-owner-v1','entries':entries,'summary':{'files':sum(e['kind']=='file' for e in entries),'directories':sum(e['kind']=='directory' for e in entries),'bytes':sum(e['size'] for e in entries if e['kind']=='file')}}
   record={'version':1,'proposal':proposal,'sha256':digest(proposal),'state':'preview','completed':[],'attempt':None,'lastError':None,'activatedIdentity':None}
   if not receipt_room(record):fail('PLAN_RECEIPT_LIMIT')
   core.json_write(receipt_path(project,proposal['planId']),record)
   core.json_write(ROOT+'/'+project+'/current.json',{'version':1,'planId':proposal['planId'],'sha256':record['sha256']})
   return record
  core.identifier(request.get('planId'),core.UUID,'PLAN_ID')
  record=validate_receipt(record_read(core,receipt_path(project,request['planId'])),request['planId'],request['sha256'])
  current=current_record(core,project)
  if current is None or current['sha256']!=record['sha256']:fail('PLAN_SUPERSEDED')
  proposal=record['proposal'];account_for_plan(value,proposal,record['state'])
  if proposal['vmId']!=request['vmId'] or proposal['projectId']!=project or proposal['directory']!=path or proposal['configSha256']!=request['configSha256'] or proposal['projectsSha256']!=request['projectsSha256'] or proposal['networkIsolation']!=request['networkIsolation']:fail('PLAN_CHANGED')
  current,fds,parent=tree(path,value);held=[]
  try:
   held=physical_overlap(path,others,fds)
   # Mount IDs are boot-local. After a real reboot, the same device/fsid/inodes/content and one current mount are still required.
   verify_tree(record,current,boot);revalidate_paths(fds,parent,path)
   if request['action']=='confirm':
    if record['state'] not in ('directory-applied','applied') or value['phase']!='active' or value['directory']!=path or value['networkIsolation']!=proposal['networkIsolation']:fail('ACTIVATION_UNCONFIRMED')
    record['state']='applied';record['activatedIdentity']=value;record['lastError']=None
    core.json_write(receipt_path(project,proposal['planId']),record);latch(core,record,value);return record
   if record['state'] in ('directory-applied','applied'):return record
   record['state']='applying';record['lastError']=None
   # The same identity lock blocks launcher admission until confirm, including after process death.
   latch(core,record,value);core.json_write(receipt_path(project,proposal['planId']),record)
   ordered=sorted(proposal['entries'],key=lambda e:(e['kind']=='directory',-e['path'].count('/'),e['path']!='.',e['path']))
   # Root directory is last: an intent cannot acquire directory access before all children finish.
   ordered=[e for e in ordered if e['path']!='.']+[proposal['entries'][0]]
   for entry in ordered:
    relative=entry['path']
    if relative in record['completed']:continue
    revalidate_paths(fds,parent,path)
    record['attempt']=relative;core.json_write(receipt_path(project,proposal['planId']),record)
    fd=fds[relative];os.fchown(fd,value['uid'],value['gid']);os.fchmod(fd,entry['targetMode']);os.fsync(fd)
    now=os.fstat(fd)
    if (now.st_uid,now.st_gid,stat.S_IMODE(now.st_mode))!=(value['uid'],value['gid'],entry['targetMode']):fail('APPLY_UNCONFIRMED',relative)
    record['completed'].append(relative);record['attempt']=None
    core.json_write(receipt_path(project,proposal['planId']),record)
   record['state']='directory-applied';core.json_write(receipt_path(project,proposal['planId']),record);latch(core,record,value)
   return record
  finally:
   for fd in held:os.close(fd)
   close_tree(fds,parent)
 except BaseException as error:
  if record is not None and record['state'] not in ('preview','applied','directory-applied'):
   record['state']='failed';record['lastError']={'code':getattr(error,'code','APPLY_IO_FAILED')}
   if getattr(error,'path',None) is not None:record['lastError']['path']=error.path
   core.json_write(receipt_path(project,record['proposal']['planId']),record);latch(core,record,value)
  if record is not None:setattr(error,'plan',record)
  raise
 finally:os.close(lock)
try:
 result=main();print(json.dumps({'ok':True,'result':result},separators=(',',':'),ensure_ascii=False))
except Exception as error:
 code=getattr(error,'code','CONTROL_IO_FAILED');path=getattr(error,'path',None)
 detail={'path':path} if isinstance(path,str) else {}
 if getattr(error,'plan',None) is not None:detail['plan']=error.plan
 print(json.dumps({'ok':False,'code':code,'detail':detail},separators=(',',':'),ensure_ascii=False));sys.exit(1)
`;

const directoryMigrationLatchSchema = z
  .object({
    version: z.literal(1),
    projectId: projectIdSchema,
    planId: z.uuid(),
    sha256: digest,
    phase: z.enum(['applying', 'failed', 'directory-applied', 'applied']),
    identity: projectIdentitySchema,
  })
  .strict()
  .refine(
    (value) =>
      value.projectId === value.identity.projectId &&
      (value.phase !== 'applied' || value.identity.phase === 'active'),
  );
/** Read-only early admission guard; native prepare checks the same latch atomically under its registry lock. */
export async function assertNoPendingProjectDirectoryMigration(
  machines: Pick<Machines, 'exec'>,
  vmId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  projectIdSchema.parse(projectId);
  const script =
    `import json,os,stat\npath=${JSON.stringify('/var/lib/sakura/project-directory-migrations/' + projectId + '/latch.json')}\n` +
    `fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)\ntry:\n` +
    ` for part in path.split('/')[1:-1]:\n` +
    `  try: child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)\n` +
    `  except FileNotFoundError: print('null');raise SystemExit(0)\n` +
    `  os.close(fd);fd=child;info=os.fstat(fd)\n` +
    `  assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\n` +
    `  if part in (${JSON.stringify('project-directory-migrations')},${JSON.stringify(projectId)}): assert stat.S_IMODE(info.st_mode)==0o700\n` +
    ` try: record=os.open('latch.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)\n` +
    ` except FileNotFoundError: print('null');raise SystemExit(0)\n` +
    ` try:\n` +
    `  info=os.fstat(record);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1\n` +
    `  data=os.read(record,8193);assert len(data)<=8192\n` +
    `  def pairs(items):\n` +
    `   value={}\n` +
    `   for key,item in items:\n` +
    `    assert key not in value;value[key]=item\n` +
    `   return value\n` +
    `  value=json.loads(data,object_pairs_hook=pairs);print(json.dumps(value))\n` +
    ` finally: os.close(record)\n` +
    `finally: os.close(fd)\n`;
  const result = await machines.exec(
    vmId,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -ec ' +
      quote(
        `set -eu\n` +
          `for sakura_migration_directory in / /var /var/lib /var/lib/sakura /var/lib/sakura/project-directory-migrations; do\n` +
          ` if sakura_migration_metadata=$(stat -c '%u %f' -- "$sakura_migration_directory" 2>&1); then\n` +
          `  set -- $sakura_migration_metadata\n` +
          `  [ "$#" -eq 2 ] && [ "$1" = 0 ] || exit 1\n` +
          `  case "$2" in ''|*[!0-9a-fA-F]*|?????????*) exit 1;; esac\n` +
          `  sakura_migration_mode=$((0x$2))\n` +
          `  [ "$((sakura_migration_mode & ~0177777))" -eq 0 ] || exit 1\n` +
          `  [ "$((sakura_migration_mode & 0170000))" -eq "$((0040000))" ] || exit 1\n` +
          `  [ "$((sakura_migration_mode & 022))" -eq 0 ] || exit 1\n` +
          ` else\n` +
          `  case "$sakura_migration_metadata" in *': No such file or directory') printf '%s\\n' null; exit 0;; esac\n` +
          `  exit 1\n` +
          ` fi\n` +
          `done\n` +
          `exec /usr/bin/python3 -I -S -c ${quote(script)}`,
      ),
    10000,
    signal,
  );
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    value = undefined;
  }
  if (result.code !== 0 || (value !== null && !directoryMigrationLatchSchema.safeParse(value).success))
    throw new AppError('目录迁移锁定记录无法核对，拒绝新运行', 409, 'PROJECT_DIRECTORY_LATCH_CHANGED');
  if (value !== null) {
    const latch = directoryMigrationLatchSchema.parse(value);
    if (latch.projectId !== projectId || latch.phase !== 'applied')
      throw new AppError(
        '目录迁移尚未完整确认，请回到原计划重试应用',
        409,
        'PROJECT_DIRECTORY_MIGRATION_PENDING',
      );
  }
}

type RunScopes = Pick<ProjectRunScopes, 'withLock'>;
export type DirectoryMigrationView = {
  version: 1;
  projectId: string;
  plan: DirectoryMigrationPlan | null;
  lastFailure: { code: string; path?: string; at: string } | null;
};
const viewSchema = z
  .object({
    version: z.literal(1),
    projectId: projectIdSchema,
    plan: directoryMigrationPlanSchema.nullable(),
    lastFailure: z
      .object({ code: z.string(), path: z.string().optional(), at: z.iso.datetime() })
      .strict()
      .nullable(),
  })
  .strict();
export class ProjectDirectoryMigrations {
  private scopes: RunScopes;
  private identities: ProjectIdentities;
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private options: { scopes?: RunScopes; sourceDirectory?: string; rootDirectory?: string } = {},
  ) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = new ProjectIdentities(machines, { sourceDirectory: options.sourceDirectory });
  }
  private file(vmId: string, id: string) {
    return join(
      this.options.rootDirectory || vmDir(vmId),
      'project-directory-migrations',
      projectIdSchema.parse(id) + '.json',
    );
  }
  async view(vmId: string): Promise<DirectoryMigrationView> {
    this.machines.get(vmId);
    const id = this.workspaces.projects.current(vmId);
    // GET only reads the already reviewed host receipt. It never installs a helper or reserves an account.
    const value = viewSchema.parse(
      await readStore(this.file(vmId, id), () => ({
        version: 1,
        projectId: id,
        plan: null,
        lastFailure: null,
      })),
    );
    if (
      value.projectId !== id ||
      (value.plan && (value.plan.proposal.vmId !== vmId || value.plan.proposal.projectId !== id))
    )
      throw new AppError('目录迁移记录不属于当前项目', 409, 'PROJECT_DIRECTORY_PLAN_CHANGED');
    return value;
  }
  private async saved(vmId: string) {
    // config() has defaults for unsaved projects. Migration requires an actual saved configuration.
    try {
      await readFile(this.workspaces.projects.file(vmId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('请先保存项目配置', 409, 'PROJECT_DIRECTORY_CONFIG_NOT_SAVED');
      throw error;
    }
    return await this.workspaces.config(vmId);
  }
  private async stopped(vmId: string, project: Project, signal?: AbortSignal) {
    assertProjectTerminalsStopped(this.machines, vmId, project._workspace || 'default');
    if (this.workspaces.jobs.list().some((job) => job.vmId === vmId && job.status === 'running'))
      throw new AppError('请等待项目操作完成后迁移目录', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    const main = new ProjectMainScope(this.machines, vmId, project);
    const mainStatus = (await main.hasReceipt())
      ? (await main.status(signal)).status
      : await legacyMainStatus(this.machines, vmId, project, signal);
    if (!['absent', 'stopped'].includes(mainStatus))
      throw new AppError('请先核对并停止项目主命令及其全部后代', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    const services = new ProjectServiceScopes(this.machines, vmId, project);
    for (const service of project.services || []) {
      if (await services.hasReceipt(service.name)) {
        if (!['absent', 'stopped'].includes((await services.status(service.name, signal)).status))
          throw new AppError('请先核对并停止项目服务及其全部后代', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
      } else {
        const result = await this.machines.exec(
          vmId,
          `if tmux has-session -t =sakura-service-${project._workspace ? project._workspace + '-' : ''}${service.name} 2>/dev/null; then echo busy; fi`,
          10000,
          signal,
        );
        if (result.code !== 0 || result.stdout.trim())
          throw new AppError('旧项目服务尚未确认停止', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
      }
    }
    const ssh = await this.machines.exec(
      vmId,
      projectSshBusyScript(project._workspace || 'default'),
      10000,
      signal,
    );
    if (ssh.code !== 0 || ssh.stdout.trim())
      throw new AppError('请先停止项目 SSH 及其编辑器进程', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    const prefix = terminalSessionPrefix(project._workspace || 'default');
    const result = await this.machines.exec(
      vmId,
      `set -eu\nif command -v tmux >/dev/null && tmux list-sessions -F '#{session_name}' >/dev/null 2>&1; then\n  for session in $(tmux list-sessions -F '#{session_name}'); do\n    case "$session" in ${prefix}*|sakura-notebook-${project._workspace || 'default'}|sakura-browser-ide-${project._workspace || 'default'}|sakura-mesh-${project._workspace || 'default'}) echo busy;; esac\n  done\nfi`,
      10000,
      signal,
    );
    if (result.code !== 0 || result.stdout.trim())
      throw new AppError('请先停止项目终端和后台开发工具', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    const paths = privateDockerPaths(project._workspace || 'default');
    const present = await this.machines.exec(
      vmId,
      `if [ -e ${quote(paths.config + '/binding.json')} ] || [ -d ${quote(paths.data)} ] || [ -S ${quote(paths.socket)} ]; then echo present; fi`,
      10000,
      signal,
    );
    if (present.code !== 0)
      throw new AppError('项目容器绑定尚未确认', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    if (present.stdout.trim()) {
      const runtime = await privateDockerStatus(this.machines, vmId, project, signal);
      if (runtime.running || runtime.containers)
        throw new AppError('请先移除项目容器并停止私有 Docker 环境', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
    }
    const projectId = project._workspace || 'default';
    const shared =
      `set -eu\nif command -v docker >/dev/null; then\n` +
      ` docker --host unix:///var/run/docker.sock version >/dev/null\n` +
      ` docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=sakura.vm=' + vmId)} --filter ${quote('label=sakura.project=' + projectId)}\n` +
      ` docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=com.docker.compose.project=sakura-' + vmId.slice(0, 8) + '-' + projectId)}\n` +
      ` docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=devcontainer.local_folder=' + project.directory)}\nfi`;
    const containers = await this.machines.exec(
      vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -ec ' + quote(shared),
      15000,
      signal,
    );
    if (containers.code !== 0 || containers.stdout.trim())
      throw new AppError('共享 Docker 的旧项目容器尚未确认移除', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
  }
  private async projects(vmId: string) {
    const result: { projectId: string; directory: string }[] = [];
    for (const project of (await this.workspaces.projects.list(vmId)).projects) {
      const config = await this.workspaces.projects.inScope(vmId, project.id, () =>
        this.workspaces.config(vmId),
      );
      result.push({ projectId: project.id, directory: config.directory });
    }
    return result.sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
  }
  private async control(vmId: string, request: object, signal?: AbortSignal) {
    const source = await projectIdentitySources(this.options.sourceDirectory);
    const build = await this.identities.install(vmId, signal);
    if (build !== source.manifest.build) throw new AppError('目录迁移身份控制器版本变化', 409);
    const payload = Buffer.from(
      JSON.stringify({
        ...request,
        version: 1,
        build,
        controllerSha256: source.manifest.files.find((file) => file.name === 'controller.py')!.sha256,
      }),
    );
    if (payload.length > 128 * 1024) throw new AppError('目录迁移请求超过边界', 413);
    const command =
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
      quote(directoryMigrationHelper);
    const result = await this.machines.execInput(vmId, command, payload, 120000, signal);
    let reply: { ok: boolean; result?: unknown; code?: string; detail?: { path?: string; plan?: unknown } };
    try {
      reply = JSON.parse(result.stdout);
    } catch {
      throw new AppError('目录迁移回执无法核对，保留原计划', 502, 'PROJECT_DIRECTORY_CONTROL_FAILED');
    }
    if (result.code !== 0 || !reply.ok) {
      const code = /^[A-Z_]{1,80}$/.test(reply.code || '') ? reply.code! : 'CONTROL_FAILED';
      const path = typeof reply.detail?.path === 'string' ? reply.detail.path.slice(0, 1023) : undefined;
      const error = new AppError(
        `目录迁移被拒绝（${code}${path ? ': ' + path : ''}）`,
        409,
        'PROJECT_DIRECTORY_' + code,
      );
      const retained = directoryMigrationPlanSchema.safeParse(reply.detail?.plan);
      Object.assign(error, {
        migrationDetail: {
          code,
          ...(path ? { path } : {}),
          ...(retained.success ? { plan: retained.data } : {}),
        },
      });
      throw error;
    }
    const plan = directoryMigrationPlanSchema.parse(reply.result);
    const input = request as {
      identity: z.infer<typeof projectIdentitySchema>;
      directory: string;
      configSha256: string;
      projectsSha256: string;
      networkIsolation: string;
    };
    const old = plan.proposal.identity,
      current = input.identity;
    if (
      plan.proposal.vmId !== vmId ||
      plan.proposal.projectId !== current.projectId ||
      plan.proposal.directory !== input.directory ||
      plan.proposal.configSha256 !== input.configSha256 ||
      plan.proposal.projectsSha256 !== input.projectsSha256 ||
      plan.proposal.networkIsolation !== input.networkIsolation ||
      (
        [
          'registryId',
          'identityId',
          'projectId',
          'account',
          'uid',
          'gid',
          'home',
          'homeDevice',
          'homeInode',
        ] as const
      ).some((key) => old[key] !== current[key])
    )
      throw new AppError('目录迁移回执与固定账户或项目不符', 409, 'PROJECT_DIRECTORY_CONTROL_FAILED');
    return plan;
  }
  async preview(vmId: string, signal?: AbortSignal) {
    return this.operation(vmId, undefined, signal);
  }
  async apply(vmId: string, input: unknown, signal?: AbortSignal) {
    return this.operation(vmId, directoryMigrationApplySchema.parse(input), signal);
  }
  private async operation(
    vmId: string,
    apply?: z.infer<typeof directoryMigrationApplySchema>,
    signal?: AbortSignal,
  ) {
    return this.machines.locked(vmId, async () => {
      signal?.throwIfAborted();
      this.machines.get(vmId);
      if (this.machines.state(vmId) !== 'running') throw new AppError('请先启动或恢复实例', 409);
      const live = this.machines.live.get(vmId),
        project = await this.saved(vmId),
        id = this.workspaces.projects.current(vmId);
      let previous = await this.view(vmId);
      if (
        apply &&
        (!previous.plan ||
          previous.plan.proposal.planId !== apply.planId ||
          previous.plan.sha256 !== apply.sha256 ||
          previous.plan.proposal.configSha256 !== projectVersion(project))
      )
        throw new AppError('计划或项目配置已变化，请重新生成预览', 409, 'PROJECT_DIRECTORY_PLAN_CHANGED');
      if (!migrationDirectoryAllowed(project.directory))
        throw new AppError(
          '仅支持 /workspace、/srv/projects 与 /opt/projects 下的独立项目目录',
          409,
          'PROJECT_DIRECTORY_NOT_ALLOWED',
        );
      await this.stopped(vmId, project, signal);
      return this.scopes.withLock(vmId, id, async (access) => {
        // Resume an explicit same-binding reservation before rejecting a durable pending ACK.
        const identity = await access.reserve(project, signal);
        await access.recoverStoppedTasks();
        await access.guard();
        const projects = await this.projects(vmId),
          configSha256 = projectVersion(project);
        for (const other of projects)
          if (
            other.projectId !== id &&
            (project.directory === other.directory ||
              project.directory.startsWith(other.directory + '/') ||
              other.directory.startsWith(project.directory + '/'))
          )
            throw new AppError(
              `目录与项目 ${other.projectId} 重叠（${other.directory}）；请先停止其入口并把项目配置改到独立目录`,
              409,
              'PROJECT_DIRECTORY_OVERLAP',
            );
        const base = {
          vmId,
          identity,
          directory: project.directory,
          networkIsolation: project.networkIsolation || 'host',
          configSha256,
          projects,
          projectsSha256: migrationPlanDigest(projects),
        };
        try {
          if (
            apply &&
            (!previous.plan ||
              previous.plan.proposal.planId !== apply.planId ||
              previous.plan.sha256 !== apply.sha256 ||
              previous.plan.proposal.configSha256 !== configSha256 ||
              previous.plan.proposal.projectsSha256 !== base.projectsSha256)
          )
            throw new AppError('计划或项目配置已变化，请重新生成预览', 409, 'PROJECT_DIRECTORY_PLAN_CHANGED');
          const unchanged = () => {
            signal?.throwIfAborted();
            if (this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running')
              throw new AppError('实例运行身份改变，目录迁移未确认', 409, 'PROJECT_DIRECTORY_CONTROL_FAILED');
          };
          unchanged();
          let plan = await this.control(
            vmId,
            {
              ...base,
              action: apply ? 'apply' : 'preview',
              ...(apply ? { planId: apply.planId, sha256: apply.sha256 } : {}),
            },
            signal,
          );
          unchanged();
          previous = { version: 1, projectId: id, plan, lastFailure: null };
          await writeStore(this.file(vmId, id), viewSchema.parse(previous));
          if (apply) {
            const activated = await access.identity(project, signal);
            unchanged();
            plan = await this.control(
              vmId,
              {
                ...base,
                identity: activated,
                action: 'confirm',
                planId: plan.proposal.planId,
                sha256: plan.sha256,
              },
              signal,
            );
            unchanged();
            previous = { ...previous, plan };
            await writeStore(this.file(vmId, id), viewSchema.parse(previous));
          }
          return previous;
        } catch (error) {
          const detail = (
            error as { migrationDetail?: { code: string; path?: string; plan?: DirectoryMigrationPlan } }
          ).migrationDetail;
          if (
            detail?.plan &&
            detail.plan.proposal.vmId === vmId &&
            detail.plan.proposal.projectId === id &&
            (!previous.plan || detail.plan.sha256 === previous.plan.sha256)
          )
            previous.plan = detail.plan;
          previous.lastFailure = {
            code:
              detail?.code ||
              (error instanceof AppError ? error.code || 'CONTROL_UNCONFIRMED' : 'CONTROL_UNCONFIRMED'),
            ...(detail?.path ? { path: detail.path } : {}),
            at: new Date().toISOString(),
          };
          await writeStore(this.file(vmId, id), viewSchema.parse(previous));
          throw error;
        }
      });
    });
  }
}
