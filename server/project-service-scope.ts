import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import type { ProjectService } from './project-services.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';

const decimal = z.string().regex(/^[1-9][0-9]*$/);
export const projectServiceRecordSchema = z.object({
  version: z.literal(1),
  projectId: projectIdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  session: z.string().regex(/^sakura-service-[a-z0-9-]+$/),
  runId: z.uuid(),
  bootId: z.uuid(),
  scopeName: z.string().regex(/^sakura-service-[a-f0-9-]{36}$/),
  inode: decimal.nullable(),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'prepared', 'running', 'stopped']),
  sessionId: z.string().regex(/^\$[0-9]+$/).nullable(),
  paneId: z.string().regex(/^%[0-9]+$/).nullable(),
  panePid: z.number().int().min(2).nullable(),
  paneStartTicks: decimal.nullable(),
}).strict().superRefine((record, ctx) => {
  const expected = `sakura-service-${record.projectId === 'default' ? '' : record.projectId + '-'}${record.name}`;
  if (record.scopeName !== 'sakura-service-' + record.runId || record.session !== expected)
    ctx.addIssue({ code: 'custom', message: '服务运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null))
    ctx.addIssue({ code: 'custom', message: '服务 pane 归属记录不完整' });
  if ((record.phase === 'prepared' || record.phase === 'running') && record.inode === null)
    ctx.addIssue({ code: 'custom', message: '服务 cgroup 归属记录不完整' });
  if (record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '服务尚未登记 pane 身份' });
});
export type ProjectServiceRecord = z.infer<typeof projectServiceRecordSchema>;
export const projectMainRecordSchema = z.object({
  version: z.literal(2), kind: z.literal('main'), projectId: projectIdSchema,
  session: z.string().regex(/^sakura-project(?:-[a-f0-9]{16})?$/),
  runId: z.uuid(), bootId: z.uuid(), scopeName: z.string().regex(/^sakura-main-[a-f0-9-]{36}$/),
  inode: decimal.nullable(), binding: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'prepared', 'running', 'stopped']),
  sessionId: z.string().regex(/^\$[0-9]+$/).nullable(), paneId: z.string().regex(/^%[0-9]+$/).nullable(),
  panePid: z.number().int().min(2).nullable(), paneStartTicks: decimal.nullable(),
}).strict().superRefine((record, ctx) => {
  const session = record.projectId === 'default' ? 'sakura-project' : `sakura-project-${record.projectId}`;
  if (record.session !== session || record.scopeName !== 'sakura-main-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '项目主命令路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null))
    ctx.addIssue({ code: 'custom', message: '项目主命令 pane 归属记录不完整' });
  if ((record.phase === 'prepared' || record.phase === 'running') && record.inode === null)
    ctx.addIssue({ code: 'custom', message: '项目主命令 cgroup 归属记录不完整' });
  if (record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '项目主命令尚未登记 pane 身份' });
});
export type ProjectMainRecord = z.infer<typeof projectMainRecordSchema>;
type ProjectScopeRecord = ProjectServiceRecord | ProjectMainRecord;
type ScopeTarget = { kind: 'service'; name: string; namespace?: 'browser-ide' | 'notebook'; deadline?: number } | { kind: 'main' };
export const projectBrowserIdeRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('browser-ide'), session: z.string().regex(/^sakura-browser-ide-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-browser-ide-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: '浏览器 IDE 运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: '浏览器 IDE 的完整 cgroup/pane 身份缺失' });
});
export type ProjectBrowserIdeRecord = z.infer<typeof projectBrowserIdeRecordSchema>;
export function projectBrowserIdeScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'browser-ide' as const, projectId, name: 'browser-ide',
    session: 'sakura-browser-ide-' + projectId, guest: '/run/sakura-browser-ide/' + projectId };
}
export const projectNotebookRecordSchema = z.object({ ...projectServiceRecordSchema.shape,
  name: z.literal('notebook'), session: z.string().regex(/^sakura-notebook-(default|[a-f0-9]{16})$/),
}).strict().superRefine((record, ctx) => {
  if (record.session !== 'sakura-notebook-' + record.projectId || record.scopeName !== 'sakura-service-' + record.runId)
    ctx.addIssue({ code: 'custom', message: 'Notebook 运行路径与身份不符' });
  const panes = [record.sessionId, record.paneId, record.panePid, record.paneStartTicks];
  if (panes.some(value => value !== null) && panes.some(value => value === null) ||
      ['prepared', 'running'].includes(record.phase) && record.inode === null ||
      record.phase === 'running' && record.panePid === null)
    ctx.addIssue({ code: 'custom', message: 'Notebook 的完整 cgroup/pane 身份缺失' });
});
export type ProjectNotebookRecord = z.infer<typeof projectNotebookRecordSchema>;
export function projectNotebookScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { namespace: 'notebook' as const, projectId, name: 'notebook',
    session: 'sakura-notebook-' + projectId, guest: '/run/sakura-notebook/' + projectId };
}
export type ProjectScopeInput = { runId: string; command: string; input: Buffer; sha256: string };
const transportSchema = z.object({ version: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(128 * 1024),
});
const responseSchema = <Record extends ProjectScopeRecord>(schema: z.ZodType<Record>) => z.object({
  status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']),
  bootId: z.uuid(),
  record: schema.nullable(),
}).strict().superRefine((response, ctx) => {
  if (['prepared', 'running', 'exited', 'stopped', 'unconfirmed'].includes(response.status) && !response.record)
    ctx.addIssue({ code: 'custom', message: '服务状态缺少可验证归属记录' });
});
export type ProjectScopeStatus<Record extends ProjectScopeRecord> = {
  status: 'absent' | 'prepared' | 'running' | 'exited' | 'stopped' | 'unconfirmed' | 'unmanaged';
  bootId: string; record: Record | null;
};
export type ProjectServiceStatus = ProjectScopeStatus<ProjectServiceRecord>;
type Operation = 'status' | 'prepare' | 'start' | 'commit' | 'stop';
export function projectServiceScopePaths(project: Project, name: string) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).parse(name);
  return { projectId, name,
    session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`,
    guest: `/run/sakura-project-services/${projectId}/${name}`,
  };
}
export function projectMainScopePaths(project: Project) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  return { kind: 'main' as const, projectId,
    session: projectId === 'default' ? 'sakura-project' : `sakura-project-${projectId}`,
    guest: `/run/sakura-project-main/${projectId}` };
}
const scopePaths = (project: Project, target: ScopeTarget) => target.kind === 'main'
  ? projectMainScopePaths(project) : target.namespace === 'browser-ide'
    ? projectBrowserIdeScopePaths(project) : target.namespace === 'notebook'
      ? projectNotebookScopePaths(project) : projectServiceScopePaths(project, target.name);
export function projectMainBinding(project: Project) {
  return createHash('sha256').update(JSON.stringify(['main-uid-v3',
    project._workspace || 'default', project.directory, project.networkIsolation || 'host',
    project.command, project.environment || {}, project.secrets || {}, project.runtimes || {},
    Boolean(project.services?.length),
  ])).digest('hex');
}
export function projectServiceBinding(project: Project, service: ProjectService) {
  return createHash('sha256').update(JSON.stringify(['service-uid-v2',
    project._workspace || 'default', project.directory, project.networkIsolation || 'host',
    project.environment || {}, service.name, service.command, service.environment || {},
  ])).digest('hex');
}

// The helper and the pane launcher run with isolated Python before any project
// environment or command. A persistent service deliberately has no task timeout.
const helper = `import fcntl,hashlib,json,os,re,signal,stat,subprocess,sys,tempfile,time
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
folder=request['guest']; owner_file=folder+'/owner.json'; cancel_file=folder+'/cancel'
main=request.get('kind')=='main'
root='/run/sakura-project-main' if main else '/run/sakura-browser-ide' if request.get('namespace')=='browser-ide' else '/run/sakura-notebook' if request.get('namespace')=='notebook' else '/run/sakura-project-services'
scope_prefix='sakura-main-' if main else 'sakura-service-'
def refuse(message): raise RuntimeError(message)
def trusted_directory(path):
 try: os.mkdir(path,0o700)
 except FileExistsError: pass
 info=os.lstat(path)
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属目录权限无法核对')
for path in [root,folder.rsplit('/',1)[0],folder]: trusted_directory(path)
lock=os.open(folder+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
info=os.fstat(lock)
if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属锁权限无法核对')
def read_owner():
 try:
  descriptor=os.open(owner_file,os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError: return None
 with os.fdopen(descriptor) as stream:
  info=os.fstat(stream.fileno())
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属文件权限无法核对')
  record=json.load(stream)
 fields={'version','projectId','session','runId','bootId','scopeName','inode','binding','phase','sessionId','paneId','panePid','paneStartTicks','kind' if main else 'name'}
 if not isinstance(record,dict) or set(record)!=fields or record['version']!=(2 if main else 1): refuse('服务归属记录不完整')
 if record['projectId']!=request['projectId'] or record['session']!=request['session']: refuse('服务归属项目不符')
 if (main and record['kind']!='main') or (not main and record['name']!=request['name']): refuse('服务归属类型不符')
 if not isinstance(record['runId'],str) or not re.fullmatch('[a-f0-9-]{36}',record['runId']) or record['scopeName']!=scope_prefix+record['runId']: refuse('服务 cgroup 路径无法核对')
 if record['phase'] not in ['prepared','running','stopped']: refuse('服务归属阶段不符')
 if record['inode'] is not None and (not isinstance(record['inode'],str) or not re.fullmatch('[1-9][0-9]*',record['inode'])): refuse('服务 cgroup inode 无法核对')
 return record
def write_owner(record):
 descriptor,temporary=tempfile.mkstemp(dir=folder,prefix='.owner-')
 try:
  with os.fdopen(descriptor,'w') as stream: json.dump(record,stream); stream.flush(); os.fsync(stream.fileno())
  os.replace(temporary,owner_file)
  directory=os.open(folder,os.O_DIRECTORY); os.fsync(directory); os.close(directory)
 finally:
  if os.path.exists(temporary): os.unlink(temporary)
def cancelled(record):
 try:
  descriptor=os.open(cancel_file,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(descriptor) as stream: return stream.read().strip()==record['runId']
 except FileNotFoundError: return False
def cancel(record):
 descriptor=os.open(cancel_file,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 with os.fdopen(descriptor,'w') as stream: stream.write(record['runId']); stream.flush(); os.fsync(stream.fileno())
def tmux_panes():
 present=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 if present.returncode:
  if any(text in present.stderr for text in ["can't find session",'no server running','No such file or directory']): return []
  refuse('无法核对 tmux 会话：'+present.stderr.strip())
 result=subprocess.run(['/usr/bin/tmux','list-panes','-s','-t','='+request['session']+':','-F','#{session_id} #{pane_id} #{pane_pid} #{pane_dead}'],capture_output=True,text=True)
 if result.returncode:
  if any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']): return []
  refuse('无法核对 tmux 会话：'+result.stderr.strip())
 return [line.split() for line in result.stdout.splitlines() if line.strip()]
def proc_fields(pid):
 try: return open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()
 except (FileNotFoundError,ProcessLookupError): return None
def pane_identity(record,panes):
 if not panes: return
 if record['panePid'] is None or len(panes)!=1: refuse('tmux pane 归属未知，拒绝终止未核对会话')
 row=panes[0]
 if len(row)!=4 or row[:3]!=[record['sessionId'],record['paneId'],str(record['panePid'])]: refuse('tmux session/pane 身份已改变，拒绝旧服务停止')
 fields=proc_fields(record['panePid'])
 if fields is not None and fields[19]!=record['paneStartTicks']: refuse('服务 pane PID 已复用，拒绝旧服务停止')
 if fields is None and row[3]!='1': refuse('服务 pane 进程身份无法核对')
def scope_path(record): return '/sys/fs/cgroup/'+record['scopeName']
def scope_descriptor(record):
 try: descriptor=os.open(scope_path(record),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 except FileNotFoundError: return None
 if record['inode'] is None or str(os.fstat(descriptor).st_ino)!=record['inode']:
  os.close(descriptor); refuse('服务 cgroup inode 已改变，拒绝旧服务停止')
 return descriptor
def populated(descriptor):
 with open('/proc/self/fd/'+str(descriptor)+'/cgroup.events') as stream:
  events=dict(line.split() for line in stream.read().splitlines())
 if events.get('populated') not in ['0','1']: refuse('服务 cgroup 空状态无法核对')
 return events['populated']=='1'

def input_file(record): return folder+'/input-'+record['runId']+'.bin'
def input_header(record,descriptor):
 info=os.fstat(descriptor)
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077 or info.st_nlink!=1: refuse('服务受保护正文权限无法核对')
 header=b''
 while not header.endswith(b'\\n') and len(header)<4096:
  part=os.read(descriptor,1)
  if not part: refuse('服务受保护正文归属不完整')
  header+=part
 value=json.loads(header)
 fields={'version','bootId','runId','scopeName','inode','binding','fileDevice','fileInode','sha256','bytes'}
 if not isinstance(value,dict) or set(value)!=fields or value['version']!=1: refuse('服务受保护正文归属不完整')
 for key in ['bootId','runId','scopeName','inode','binding']:
  if value[key]!=record[key]: refuse('服务受保护正文属于其他运行')
 if value['fileDevice']!=str(info.st_dev) or value['fileInode']!=str(info.st_ino): refuse('服务受保护正文文件已被替换')
 expected=request.get('transport')
 if not isinstance(expected,dict) or set(expected)!={'version','sha256','bytes'} or expected['version']!=1 or value['sha256']!=expected['sha256'] or value['bytes']!=expected['bytes']: refuse('服务受保护正文与主机摘要不符')
 return value

def stage_input(record):
 expected=request['transport']
 if not isinstance(expected['bytes'],int) or expected['bytes']<1 or expected['bytes']>131072 or not re.fullmatch('[a-f0-9]{64}',expected['sha256']): refuse('服务受保护正文预算或摘要不符')
 data=sys.stdin.buffer.read(expected['bytes']+1)
 if len(data)!=expected['bytes'] or hashlib.sha256(data).hexdigest()!=expected['sha256']: refuse('服务受保护正文运输未确认；项目代码未执行')
 info=os.lstat(folder)
 if info.st_mode&0o077: refuse('服务正文目录需要 root 0700；项目代码未执行')
 descriptor=os.open(input_file(record),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  info=os.fstat(descriptor)
  header={key:record[key] for key in ['bootId','runId','scopeName','inode','binding']}
  header.update(version=1,fileDevice=str(info.st_dev),fileInode=str(info.st_ino),sha256=expected['sha256'],bytes=len(data))
  with os.fdopen(descriptor,'wb',closefd=False) as stream:
   stream.write(json.dumps(header,separators=(',',':')).encode()+b'\\n'); stream.write(data); stream.flush(); os.fsync(descriptor)
 finally: os.close(descriptor)
 directory=os.open(folder,os.O_DIRECTORY)
 try: os.fsync(directory)
 finally: os.close(directory)

def consume_input(record):
 descriptor=os.open(input_file(record),os.O_RDONLY|os.O_NOFOLLOW)
 try:
  header=input_header(record,descriptor)
  with os.fdopen(descriptor,'rb',closefd=False) as stream: data=stream.read(header['bytes']+1)
  if len(data)!=header['bytes'] or hashlib.sha256(data).hexdigest()!=header['sha256']: refuse('服务受保护正文长度或摘要已改变；项目代码未执行')
  return data
 finally: os.close(descriptor)

def clean_input(record):
 try: descriptor=os.open(input_file(record),os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError: return
 try:
  input_header(record,descriptor)
  actual=os.lstat(input_file(record)); pinned=os.fstat(descriptor)
  if actual.st_dev!=pinned.st_dev or actual.st_ino!=pinned.st_ino: refuse('服务受保护正文在清理前已被替换')
  os.unlink(input_file(record))
 finally: os.close(descriptor)
def expect_owner(record):
 expected=request['record']
 if expected['bootId']!=boot or record['bootId']!=boot: refuse('客户机 boot 身份已改变，拒绝旧服务操作')
 for key in ['runId','scopeName','binding']:
  if record[key]!=expected[key]: refuse('服务 run 身份已改变，拒绝旧服务操作')
 if expected['inode'] is not None and record['inode']!=expected['inode']: refuse('服务 cgroup inode 记录已改变')
 if expected['panePid'] is not None:
  for key in ['sessionId','paneId','panePid','paneStartTicks']:
   if record[key]!=expected[key]: refuse('服务 pane 记录已改变')
def capabilities():
 unified=False
 for line in open('/proc/self/mountinfo'):
  fields=line.split()
  if len(fields)>9 and fields[4]=='/sys/fs/cgroup' and fields[fields.index('-')+1]=='cgroup2': unified=True
 if not unified and os.path.isfile('/sbin/rc-service'):
  subprocess.run(['/sbin/rc-service','cgroups','start'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for line in open('/proc/self/mountinfo'):
   fields=line.split()
   if fields[4]=='/sys/fs/cgroup' and fields[fields.index('-')+1]=='cgroup2': unified=True
 if not unified or os.path.islink('/sys/fs/cgroup'): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 服务需要可写 cgroup v2；项目代码未执行')
 if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 服务需要 Linux pidfd；项目代码未执行')
 descriptor=os.pidfd_open(os.getpid()); os.close(descriptor)
def result(status,record=None): print(json.dumps({'status':status,'bootId':boot,'record':record}))
def status():
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner(); panes=tmux_panes()
 if record is None: result('unmanaged' if panes else 'absent'); return
 if record['bootId']!=boot: refuse('服务归属 boot 身份已改变')
 pane_identity(record,panes)
 descriptor=scope_descriptor(record)
 if record['phase']=='stopped':
  if descriptor is not None or panes: refuse('已停止服务的 scope 或 pane 被替换')
  result('stopped',record); return
 if descriptor is None:
  if panes: refuse('服务 cgroup 归属已缺失，但 pane 仍存在')
  result('exited',record); return
 try:
  busy=populated(descriptor)
  if record['phase']=='running':
   fields=proc_fields(record['panePid'])
   if not panes or fields is None or fields[0] in ['Z','X'] or not busy:
    result('exited',record); return
   if '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('服务 pane 已离开所属 cgroup')
  result(record['phase'],record)
 finally: os.close(descriptor)
def prepare():
 fcntl.flock(lock,fcntl.LOCK_EX)
 expected=request['record']
 if expected['bootId']!=boot: refuse('客户机 boot 身份已改变；服务未创建')
 if cancelled(expected): refuse('服务启动已取消；项目代码未执行')
 record=read_owner()
 if tmux_panes(): refuse('tmux 会话已有运行或未知归属，拒绝替换')
 if record is not None and record['phase']!='stopped': refuse('已有服务归属尚未停止')
 if record is not None and os.path.lexists(scope_path(record)): refuse('已停止服务的旧 cgroup 被替换，拒绝覆盖归属')
 capabilities()
 path=scope_path(expected)
 try: os.mkdir(path)
 except OSError as error: refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 无法创建服务 cgroup；项目代码未执行：'+str(error))
 record=dict(expected,phase='prepared',inode=str(os.stat(path).st_ino))
 write_owner(record)
 if not os.access(path+'/cgroup.kill',os.W_OK): refuse('SAKURA_SERVICE_SCOPE_UNAVAILABLE: 客户机缺少可写 cgroup.kill；项目代码未执行')
 result('prepared',record)
def launch():
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner()
 if record is None: refuse('服务 prepared 归属缺失')
 expect_owner(record)
 if record['phase']!='prepared' or cancelled(record): refuse('服务启动已取消或提交')
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('服务 prepared cgroup 已缺失')
 os.close(descriptor)
 if tmux_panes(): refuse('tmux 会话已被占用，拒绝替换')
 stage_input(record)
 pane_script=request['paneScript']
 pane_file=folder+'/pane-'+record['runId']+'.py'
 script_file=os.open(pane_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(script_file,'w') as stream: stream.write(pane_script); stream.flush(); os.fsync(stream.fileno())
 created=subprocess.run(['/usr/bin/tmux','new-session','-d','-s',request['session'],'-c','/','-P','-F','#{session_id} #{pane_id} #{pane_pid}', '/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','HOME=/root','LANG=C','LC_ALL=C','/usr/bin/python3','-I','-S',pane_file],capture_output=True,text=True)
 if created.returncode: refuse('无法创建服务 pane：'+created.stderr.strip())
 row=created.stdout.strip().split()
 if len(row)!=3 or not re.fullmatch(r'\\$[0-9]+',row[0]) or not re.fullmatch('%[0-9]+',row[1]) or not row[2].isdigit(): refuse('新建服务 pane 身份无法核对')
 fields=proc_fields(int(row[2]))
 if fields is None: refuse('新建服务 pane 已退出')
 record.update(sessionId=row[0],paneId=row[1],panePid=int(row[2]),paneStartTicks=fields[19])
 write_owner(record)
 options=subprocess.run(['/usr/bin/tmux','set-window-option','-t',record['paneId'],'remain-on-exit','off'],capture_output=True,text=True)
 if options.returncode: refuse('无法确认服务 pane 退出策略：'+options.stderr.strip())
 fcntl.flock(lock,fcntl.LOCK_UN)
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  fcntl.flock(lock,fcntl.LOCK_EX)
  current=read_owner(); expect_owner(current)
  if cancelled(current): refuse('服务启动已取消')
  pane_identity(current,tmux_panes())
  try: groups=open('/proc/'+str(current['panePid'])+'/cgroup').read().splitlines()
  except FileNotFoundError: refuse('服务 pane 在提交前退出')
  if '0::/'+current['scopeName'] in groups: result('prepared',current); return
  fcntl.flock(lock,fcntl.LOCK_UN); time.sleep(0.05)
 refuse('服务 pane 未进入已登记 cgroup；项目代码未执行')
def commit():
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner(); expect_owner(record)
 if cancelled(record) or record['phase']!='prepared': refuse('服务启动已取消或已提交')
 pane_identity(record,tmux_panes())
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('服务 cgroup 已缺失')
 os.close(descriptor)
 if '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('服务 pane 未进入 cgroup；拒绝执行项目代码')
 record['phase']='running'; write_owner(record)
 if request.get('namespace')=='browser-ide':
  deadline=request.get('deadline')
  if not isinstance(deadline,int) or not time.time()<deadline<=time.time()+14400: refuse('浏览器 IDE 时限不符')
  path=folder+'/watchdog-'+record['runId']+'.py'
  descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(descriptor,'w') as stream: stream.write(request['watchdogScript']); stream.flush(); os.fsync(stream.fileno())
  subprocess.Popen(['/usr/bin/python3','-I','-S',path],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'},close_fds=True,start_new_session=True)
 result('running',record)
def stop():
 fcntl.flock(lock,fcntl.LOCK_EX)
 expected=request['record']
 if expected['bootId']!=boot: refuse('客户机 boot 身份已改变，拒绝旧服务停止')
 record=read_owner()
 if record is None or (record['runId']!=expected['runId'] and record['phase']=='stopped'):
  if os.path.lexists(scope_path(expected)) or tmux_panes(): refuse('服务归属未知，拒绝未核对停止')
  if record is not None and os.path.lexists(scope_path(record)): refuse('旧服务 cgroup 已被替换，拒绝覆盖归属')
  cancel(expected); clean_input(expected); stopped=dict(expected,phase='stopped'); write_owner(stopped); result('stopped',stopped); return
 expect_owner(record)
 panes=tmux_panes(); pane_identity(record,panes)
 descriptor=scope_descriptor(record)
 cancel(record)
 pidfd=None
 try:
  if record['panePid'] is not None:
   fields=proc_fields(record['panePid'])
   if fields is not None and fields[0] not in ['Z','X']:
    if fields[19]!=record['paneStartTicks']: refuse('服务 pane PID 已复用')
    pidfd=os.pidfd_open(record['panePid'])
    again=proc_fields(record['panePid'])
    if again is None or again[19]!=record['paneStartTicks']: refuse('服务 pane 身份在停止前已改变')
    if record['phase']=='running' and '0::/'+record['scopeName'] not in open('/proc/'+str(record['panePid'])+'/cgroup').read().splitlines(): refuse('已提交服务 pane 离开所属 cgroup，拒绝猜测停止')
    signal.pidfd_send_signal(pidfd,signal.SIGTERM)
  if descriptor is not None:
   if '0::/'+record['scopeName'] in open('/proc/self/cgroup').read().splitlines(): refuse('不能从被停止的服务 cgroup 内执行清理')
   time.sleep(0.2)
   if populated(descriptor):
    kill=os.open('cgroup.kill',os.O_WRONLY,dir_fd=descriptor)
    try: os.write(kill,b'1')
    finally: os.close(kill)
   deadline=time.monotonic()+10
   while populated(descriptor):
    if time.monotonic()>=deadline: refuse('服务 cgroup 子进程尚未停止')
    time.sleep(0.05)
  # A registered pane may still be waiting for the scope lock before its first
  # cgroup entry. pidfd addresses that exact process, never a reused PID.
  if pidfd is not None:
   try: signal.pidfd_send_signal(pidfd,signal.SIGKILL)
   except ProcessLookupError: pass
  deadline=time.monotonic()+5
  while tmux_panes():
   pane_identity(record,tmux_panes())
   if time.monotonic()>=deadline: refuse('原服务 pane 尚未退出，停止未确认')
   time.sleep(0.05)
  if descriptor is not None:
   if str(os.stat(scope_path(record)).st_ino)!=record['inode']: refuse('服务 cgroup 路径在删除前已改变')
   for path,children,files in os.walk(scope_path(record),topdown=False): os.rmdir(path)
  clean_input(record)
  for prefix in ['pane-','watchdog-']:
   try: os.unlink(folder+'/'+prefix+record['runId']+'.py')
   except FileNotFoundError: pass
  record['phase']='stopped'; write_owner(record); result('stopped',record)
 finally:
  if pidfd is not None: os.close(pidfd)
  if descriptor is not None: os.close(descriptor)
def watchdog():
 expected=request['record']; deadline=request['deadline']
 if request.get('namespace')!='browser-ide' or not isinstance(deadline,int) or deadline>time.time()+14400: refuse('浏览器 IDE guard 身份不符')
 # The guard runs outside the service. Hold the original cgroup descriptor;
 # its inode cannot become authority over a later run with a reused name.
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=read_owner(); expect_owner(record)
 if record['phase']=='stopped': return
 descriptor=scope_descriptor(record)
 if descriptor is None: refuse('浏览器 IDE guard 缺少原完整域')
 fcntl.flock(lock,fcntl.LOCK_UN)
 try:
  until=time.monotonic()+max(0,deadline-time.time())
  while time.monotonic()<until:
   time.sleep(max(0,min(5,until-time.monotonic())))
   fcntl.flock(lock,fcntl.LOCK_EX)
   record=read_owner()
   if record is None or record['runId']!=expected['runId'] or record['phase']=='stopped': return
   expect_owner(record)
   fcntl.flock(lock,fcntl.LOCK_UN)
  # stop rechecks the original receipt, boot, pane ticks and inode and removes
  # the whole group. Native ticket retirement is left for host recovery.
  stop()
 finally: os.close(descriptor)
def pane():
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  fcntl.flock(lock,fcntl.LOCK_EX)
  record=read_owner(); expect_owner(record)
  if cancelled(record) or record['phase']=='stopped': refuse('服务启动已取消；项目代码未执行')
  if record['panePid'] is not None:
   if record['panePid']!=os.getpid() or proc_fields(os.getpid())[19]!=record['paneStartTicks']: refuse('当前 pane 不属于本次启动')
   pane_identity(record,tmux_panes())
   descriptor=scope_descriptor(record)
   if descriptor is None: refuse('服务 cgroup 已缺失；项目代码未执行')
   try:
    with open('/proc/self/fd/'+str(descriptor)+'/cgroup.procs','w') as stream: stream.write(str(os.getpid()))
   finally: os.close(descriptor)
   if '0::/'+record['scopeName'] not in open('/proc/self/cgroup').read().splitlines(): refuse('服务未进入已登记 cgroup；项目代码未执行')
   if record['phase']=='running':
    data=consume_input(record)
    fcntl.flock(lock,fcntl.LOCK_UN)
    os.close(lock)
    log_file=request['logFile']
    log_descriptor=os.open(log_file,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    info=os.fstat(log_descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1: refuse('服务日志归属无法核对')
    os.fchmod(log_descriptor,0o600)
    os.ftruncate(log_descriptor,0)
    with os.fdopen(log_descriptor,'wb') as output:
     child=subprocess.Popen(['/bin/sh','-c',request['command']],stdin=subprocess.PIPE,stdout=output,stderr=output,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','LC_ALL':'C'},close_fds=True)
     child.communicate(data)
    sys.exit(child.returncode if child.returncode>=0 else 128-child.returncode)
  fcntl.flock(lock,fcntl.LOCK_UN); time.sleep(0.05)
 refuse('服务提交等待超时；项目代码未执行；归属记录已保留')
try:
 {'status':status,'prepare':prepare,'start':launch,'commit':commit,'stop':stop,'pane':pane,'watchdog':watchdog}[request['op']]()
except Exception as error:
 print('SAKURA_SERVICE_SCOPE_REFUSED: '+str(error),file=sys.stderr); sys.exit(73)
`;

export function projectBrowserIdeScopeCommand(project: Project, op: Operation, record?: ProjectBrowserIdeRecord, payload?: ProjectScopeInput, deadline?: number, transport?: z.infer<typeof transportSchema>) {
  return projectScopeCommand(project, { kind: 'service', name: 'browser-ide', namespace: 'browser-ide', deadline }, op, record, payload, transport);
}

export function projectNotebookScopeCommand(project: Project, op: Operation, record?: ProjectNotebookRecord,
  payload?: ProjectScopeInput, transport?: z.infer<typeof transportSchema>) {
  return projectScopeCommand(project, { kind: 'service', name: 'notebook', namespace: 'notebook' }, op, record, payload, transport);
}

function python(request: object) {
  return `request=json.loads(${JSON.stringify(JSON.stringify(request))})\n`;
}
function projectScopeCommand(project: Project, target: ScopeTarget, op: Operation,
  record?: ProjectScopeRecord, payload?: ProjectScopeInput,
  transport?: z.infer<typeof transportSchema>) {
  const paths = scopePaths(project, target);
  const executionHelper = target.kind === 'main'
    ? helper.replaceAll('服务', '项目主命令').replaceAll('SAKURA_SERVICE_SCOPE_', 'SAKURA_PROJECT_MAIN_SCOPE_') : helper;
  const request: any = { op, ...paths, ...(record ? { record } : {}), ...(transport ? { transport } : {}) };
  if (target.kind === 'service' && target.namespace === 'browser-ide' && op === 'commit') {
    if (!record || !Number.isSafeInteger(target.deadline) || target.deadline! <= Math.floor(Date.now() / 1000) ||
        target.deadline! > Math.floor(Date.now() / 1000) + 14400)
      throw new AppError('浏览器 IDE 时限或原运行记录不符', 409, 'BROWSER_IDE_SCOPE_CHANGED');
    request.deadline = target.deadline;
    request.watchdogScript = 'import json\n' + python({ op: 'watchdog', ...paths,
      record: { ...record, phase: 'running' }, deadline: target.deadline,
      ...(transport ? { transport } : {}) }) + executionHelper;
  }
  if (op === 'start') {
    if (!record || !payload || payload.runId !== record.runId || !Buffer.isBuffer(payload.input) ||
        !/^[a-f0-9]{64}$/.test(payload.sha256) || payload.input.length < 1 || payload.input.length > 128 * 1024 ||
        createHash('sha256').update(payload.input).digest('hex') !== payload.sha256 ||
        typeof payload.command !== 'string' || payload.command.length > 8192 || /[\x00-\x1f\x7f]/.test(payload.command))
      throw new AppError('项目账号受保护正文或运行身份无法核对', 409,
        target.kind === 'main' ? 'PROJECT_MAIN_SCOPE_CHANGED' : 'SERVICE_SCOPE_CHANGED');
    request.transport = transportSchema.parse({ version: 1, sha256: payload.sha256, bytes: payload.input.length });
    const paneRequest = { op: 'pane', ...paths, record, transport: request.transport,
      command: payload.command, logFile: `/tmp/${paths.session}.log` };
    request.paneScript = 'import json\n' + python(paneRequest) + executionHelper;
  }
  const source = 'import json\n' + python(request) + executionHelper;
  const { paneScript: _paneScript, watchdogScript: _watchdogScript, ...metadata } = request;
  return `# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_${op.toUpperCase()}\n` +
    `# SAKURA_PROJECT_${target.kind === 'main' ? 'MAIN' : 'SERVICE'}_REQUEST=${Buffer.from(JSON.stringify(metadata)).toString('base64')}\n` +
    `set -eu\nif [ ! -x /usr/bin/python3 ] || [ ! -x /usr/bin/tmux ]; then ` +
    `echo 'SAKURA_${target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_SCOPE_UNAVAILABLE: ` +
    `受管运行需要 python3、tmux 和可写 cgroup v2；项目代码未执行' >&2; exit 73; fi\n` +
    `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`;
}
export function projectServiceScopeCommand(project: Project, name: string, op: Operation,
  record?: ProjectServiceRecord, payload?: ProjectScopeInput) {
  return projectScopeCommand(project, { kind: 'service', name }, op, record, payload);
}
export function projectMainScopeCommand(project: Project, op: Operation, record?: ProjectMainRecord, payload?: ProjectScopeInput) {
  return projectScopeCommand(project, { kind: 'main' }, op, record, payload);
}

class ProjectProcessScope<Record extends ProjectScopeRecord> {
  private readonly instance: object | undefined;
  constructor(private machines: Machines, private id: string, protected project: Project,
    private target: ScopeTarget, private schema: z.ZodType<Record>, instance: object | undefined) {
    this.instance = instance;
  }
  private code(suffix: string) { return `${this.target.kind === 'main' ? 'PROJECT_MAIN' : 'SERVICE'}_${suffix}`; }
  private get label() { return this.target.kind === 'main' ? '项目主命令' : `服务 ${this.target.name}`; }
  private assertLive() {
    if (!this.instance || this.machines.live.get(this.id) !== this.instance)
      throw new AppError(`客户机 live 实例已改变，拒绝旧${this.label}操作`, 409, this.code('SCOPE_CHANGED'));
  }
  receipt() {
    const p = scopePaths(this.project, this.target);
    return this.target.kind === 'service' && this.target.namespace === 'browser-ide'
      ? join(vmDir(this.id), 'project-browser-ide', p.projectId, 'runtime.json')
      : this.target.kind === 'service' && this.target.namespace === 'notebook'
      ? join(vmDir(this.id), 'project-notebooks', p.projectId, 'runtime.json')
      : this.target.kind === 'main'
      ? join(vmDir(this.id), 'project-main', p.projectId, 'runtime.json')
      : join(vmDir(this.id), 'project-services', p.projectId, this.target.name, 'runtime.json');
  }
  async hasReceipt() {
    try { await lstat(this.receipt()); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  async metadata() {
    try {
      const saved = await readStore<unknown>(this.receipt(), () => null);
      return saved === null ? null : this.schema.parse(saved);
    }
    catch { throw new AppError(`主机${this.label}归属记录无法核对`, 409, this.code('SCOPE_CHANGED')); }
  }
  private async save(record: Record) {
    this.assertLive();
    const file = this.receipt();
    await regularDirectory(join(file, '..'));
    await writeStore(file, this.schema.parse(record));
    this.assertLive();
  }
  async persistIntent(record: Record) {
    if (record.phase !== 'intent') throw new AppError('运行意图阶段不符', 409, this.code('SCOPE_CHANGED'));
    this.assertLive();
    const previous = await this.metadata();
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(record)) return;
      if (previous.phase !== 'stopped' || previous.runId === record.runId)
        throw new AppError(`${this.label}原运行尚未完成清理，拒绝覆盖归属记录`, 409, this.code('SCOPE_CHANGED'));
      const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
      if (await identities.hasRun(this.id, previous.projectId, previous.runId))
        await identities.closeAfterScopeStopped(this.id, previous.projectId, previous.runId);
      this.assertLive();
      if (JSON.stringify(await this.metadata()) !== JSON.stringify(previous))
        throw new AppError(`${this.label}归属在账号清理期间已改变，拒绝覆盖`, 409, this.code('SCOPE_CHANGED'));
    }
    await this.save(record);
  }
  private transportFile(record: Record) {
    return join(this.receipt(), '..', `transport-${record.runId}.json`);
  }
  protected async transport(record: Record) {
    try {
      const value = await readStore<unknown>(this.transportFile(record), () => null);
      if (value === null) return undefined;
      const stored = z.object({ version: z.literal(1), record: this.schema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(128 * 1024),
        commandSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
      this.sameOwner(stored.record, record);
      return transportSchema.parse({ version: 1, sha256: stored.sha256, bytes: stored.bytes });
    } catch { throw new AppError(`${this.label}受保护正文归属记录无法核对`, 409, this.code('SCOPE_CHANGED')); }
  }
  private async saveTransport(record: Record, payload: ProjectScopeInput) {
    this.assertLive();
    const metadata = { version: 1, record, sha256: payload.sha256, bytes: payload.input.length,
      commandSha256: createHash('sha256').update(payload.command).digest('hex') };
    // Immutable per-run metadata is persisted before transporting any body.
    // An acknowledgement lost for this run must never overwrite its old frame.
    await writeFile(this.transportFile(record), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    this.assertLive();
  }
  private async execute(op: Operation, record?: Record,
    payload?: ProjectScopeInput, signal?: AbortSignal) {
    this.assertLive();
    const transport = record ? await this.transport(record) : undefined;
    const command = projectScopeCommand(this.project, this.target, op, record, payload, transport);
    const request = op === 'start'
      ? this.machines.execInput(this.id, command, payload!.input, 30_000, signal)
      : this.machines.exec(this.id, command, 30_000, signal);
    const result = await request.catch((error) => {
        signal?.throwIfAborted();
        this.assertLive();
        if (this.target.kind !== 'main') throw error;
        throw new AppError(`项目主命令控制回执未确认：${error instanceof Error ? error.message : String(error)}`,
          409, this.code('SCOPE_CHANGED'));
      });
    this.assertLive();
    if (result.code !== 0)
      throw new AppError(result.stderr.trim() || `无法${op}${this.label}`, 409,
        result.stderr.includes(this.code('SCOPE_UNAVAILABLE')) ? this.code('SCOPE_UNAVAILABLE') : this.code('SCOPE_CHANGED'));
    let response: ProjectScopeStatus<Record>;
    try { response = responseSchema(this.schema).parse(JSON.parse(result.stdout)); }
    catch { throw new AppError(`${this.label}归属回执无法核对，拒绝继续操作`, 409, this.code('SCOPE_CHANGED')); }
    if (response.record && response.record.bootId !== response.bootId)
      throw new AppError(`${this.label}回执 boot 身份不符`, 409, this.code('SCOPE_CHANGED'));
    if (record && response.bootId !== record.bootId)
      throw new AppError('客户机 boot 身份已改变', 409, this.code('SCOPE_CHANGED'));
    if (record && response.record && (response.record.runId !== record.runId || response.record.scopeName !== record.scopeName))
      throw new AppError(`客体回执与本次${this.label} run 不符`, 409, this.code('SCOPE_CHANGED'));
    if (record && response.record) this.sameOwner(record, response.record);
    return response;
  }
  private sameOwner(expected: Record, actual: Record) {
    for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
      if (expected[key] !== actual[key])
        throw new AppError(`${this.label}运行归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'));
    for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
      if (expected[key] !== null && expected[key] !== actual[key])
        throw new AppError(`${this.label} cgroup 或 pane 归属已改变，拒绝旧操作`, 409, this.code('SCOPE_CHANGED'));
  }
  async status(signal?: AbortSignal) {
    const status = await this.execute('status', undefined, undefined, signal);
    if (status.status === 'unmanaged')
      throw new AppError(`旧 tmux ${this.label}缺少可验证归属，请明确关闭旧会话后重新启动；未自动停止任何进程`, 409, this.code('SCOPE_UNMANAGED'));
    const saved = await this.metadata();
    if (saved && status.record) this.sameOwner(saved, status.record);
    if (saved && !status.record && status.status === 'absent' && saved.phase !== 'stopped' && saved.bootId === status.bootId)
      return { ...status, status: 'unconfirmed' as const, record: saved };
    return status;
  }
  newIntent(binding: string, bootId: string): Record {
    const paths = scopePaths(this.project, this.target), runId = randomUUID();
    return this.schema.parse({ ...(this.target.kind === 'main' ? { version: 2, kind: 'main' }
      : { version: 1, name: this.target.name }), projectId: paths.projectId, session: paths.session,
      runId, bootId, scopeName: `sakura-${this.target.kind === 'main' ? 'main' : 'service'}-${runId}`, inode: null,
      binding, phase: 'intent', sessionId: null, paneId: null, panePid: null, paneStartTicks: null });
  }
  async start(record: Record, payload: ProjectScopeInput, signal: AbortSignal) {
    // Validate and copy the caller's bytes before the first await. No root
    // command contains the body; it is delivered only to execInput's stdin.
    projectScopeCommand(this.project, this.target, 'start', record, payload);
    payload = { ...payload, input: Buffer.from(payload.input) };
    await this.persistIntent(record);
    if (!await new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines).hasRun(this.id, record.projectId, record.runId))
      throw new AppError(`${this.label}缺少已保存的项目账号运行票据，项目代码未执行`, 409, this.code('IDENTITY_REQUIRED'));
    signal.throwIfAborted();
    const prepared = await this.execute('prepare', record, undefined, signal);
    if (prepared.status !== 'prepared' || !prepared.record)
      throw new AppError(`${this.label} prepared 回执不完整`, 409, this.code('SCOPE_CHANGED'));
    await this.save(prepared.record);
    await this.saveTransport(prepared.record, payload);
    const pane = await this.execute('start', prepared.record, payload, signal);
    if (pane.status !== 'prepared' || !pane.record?.panePid)
      throw new AppError(`${this.label} pane 回执不完整`, 409, this.code('SCOPE_CHANGED'));
    await this.save(pane.record);
    const committed = await this.execute('commit', pane.record, undefined, signal);
    if (committed.status !== 'running' || !committed.record)
      throw new AppError(`${this.label}提交回执未确认`, 409, this.code('SCOPE_CHANGED'));
    await this.save(committed.record);
    return committed.record;
  }
  private async retireRebootedService(record: Record, log?: (text: string) => void) {
    if (this.target.kind !== 'service') return false;
    this.assertLive();
    const request = { op: 'probe-reboot', ...scopePaths(this.project, this.target), record };
    const source = `import fcntl,json,os,stat,subprocess
request=json.loads(${JSON.stringify(JSON.stringify(request))})
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
if boot==request['record']['bootId']:
 print(json.dumps({'bootId':boot,'retired':False}))
else:
 folder=request['guest']
 root='/run/sakura-browser-ide' if request.get('namespace')=='browser-ide' else '/run/sakura-notebook' if request.get('namespace')=='notebook' else '/run/sakura-project-services'
 for path in [root,folder.rsplit('/',1)[0],folder]:
  try: os.mkdir(path,0o700)
  except FileExistsError: pass
  info=os.lstat(path)
  assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 lock=os.open(folder+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 info=os.fstat(lock)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
 fcntl.flock(lock,fcntl.LOCK_EX)
 assert not os.path.lexists(folder+'/owner.json'),'新 boot 已有服务归属，拒绝旧运行停止'
 assert not os.path.lexists('/sys/fs/cgroup/'+request['record']['scopeName']),'新 boot 已有同路径 cgroup，拒绝旧运行停止'
 result=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 assert result.returncode!=0,'新 boot 已有同名 pane，拒绝旧运行停止'
 assert any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']),'新 boot 的 tmux 状态无法核对'
 print(json.dumps({'bootId':boot,'retired':True}))
`;
    const unchanged = async () => {
      this.assertLive();
      const saved = await this.metadata(); this.assertLive();
      if (!saved || JSON.stringify({ ...saved, phase: record.phase }) !== JSON.stringify(record) ||
          (saved.phase !== record.phase && saved.phase !== 'stopped'))
        throw new AppError('主机服务完整归属已改变，拒绝旧运行停止', 409, this.code('SCOPE_CHANGED'));
      return saved;
    };
    await unchanged();
    const result = await this.machines.exec(this.id, '# SAKURA_PROJECT_SERVICE_REBOOT_STOP\n' +
      '# SAKURA_PROJECT_SERVICE_REQUEST=' + Buffer.from(JSON.stringify(request)).toString('base64') + '\n' +
      `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const saved = await unchanged();
    const response = result.code === 0 && z.object({ bootId: z.uuid(), retired: z.boolean() }).strict()
      .safeParse((() => { try { return JSON.parse(result.stdout); } catch { return null; } })());
    if (!response || !response.success || response.data.retired !== (response.data.bootId !== record.bootId))
      throw new AppError(result.stderr.trim() || '服务重启归属回执未确认', 409, this.code('SCOPE_CHANGED'));
    if (!response.data.retired) return false;
    if (saved.phase !== 'stopped') await this.save({ ...saved, phase: 'stopped' });
    await unchanged();
    const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
    if (await identities.hasRun(this.id, record.projectId, record.runId))
      await identities.closeAfterScopeStopped(this.id, record.projectId, record.runId);
    await unchanged(); log?.(`${this.label}所属旧 boot 已结束；未向新 boot 进程发送停止信号\n`);
    return true;
  }
  async stop(record: Record, log?: (text: string) => void) {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; ++attempt) {
      try {
        this.assertLive();
        const stored = await this.metadata();
        let expected = record;
        if (stored) {
          const current = stored;
          // An interrupted prepare can leave the host intent less complete than
          // the guest's root-owned receipt. Compare every identity both sides
          // know, then carry the fuller identity into the guarded guest stop.
          for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
            if (current[key] !== record[key])
              throw new AppError(`主机${this.label} run 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'));
          for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
            if (current[key] !== null && record[key] !== null && current[key] !== record[key])
              throw new AppError(`主机${this.label} cgroup 或 pane 已改变，拒绝旧回滚`, 409, this.code('SCOPE_CHANGED'));
          expected = { ...record, inode: current.inode ?? record.inode,
            sessionId: current.sessionId ?? record.sessionId, paneId: current.paneId ?? record.paneId,
            panePid: current.panePid ?? record.panePid, paneStartTicks: current.paneStartTicks ?? record.paneStartTicks };
        }
        if (await this.retireRebootedService(stored || record, log)) return;
        const stopped = await this.execute('stop', expected);
        if (stopped.status !== 'stopped' || !stopped.record)
          throw new AppError(`${this.label}全 scope 停止未确认`, 409, this.code('SCOPE_CHANGED'));
        await this.save(stopped.record);
        const identities = new (await import('./project-run-scope.ts')).ProjectRunScopes(this.machines);
        if (await identities.hasRun(this.id, record.projectId, record.runId))
          await identities.closeAfterScopeStopped(this.id, record.projectId, record.runId);
        this.assertLive();
        return;
      } catch (error) {
        failure = error;
        log?.(`${this.label}清理第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);
        if (this.machines.live.get(this.id) !== this.instance) break;
        if (attempt < 2) await delay(250 * (attempt + 1));
      }
    }
    throw new AppError(`${this.label}清理未确认：${failure instanceof Error ? failure.message : String(failure)}；` +
      `已保留运行记录 ${this.receipt()}`, 503, this.code('CLEANUP_FAILED'));
  }
}

export class ProjectServiceScopes {
  private readonly instance: object | undefined;
  constructor(private machines: Machines, private id: string, private project: Project) {
    this.instance = machines.live.get(id);
  }
  private scope(name: string) {
    return new ProjectProcessScope(this.machines, this.id, this.project,
      { kind: 'service', name }, projectServiceRecordSchema, this.instance);
  }
  receipt(name: string) { return this.scope(name).receipt(); }
  hasReceipt(name: string) { return this.scope(name).hasReceipt(); }
  metadata(name: string) { return this.scope(name).metadata(); }
  status(name: string, signal?: AbortSignal) { return this.scope(name).status(signal); }
  intent(service: ProjectService, bootId: string) {
    return this.scope(service.name).newIntent(projectServiceBinding(this.project, service), bootId);
  }
  persistIntent(record: ProjectServiceRecord) { return this.scope(record.name).persistIntent(record); }
  start(record: ProjectServiceRecord, payload: ProjectScopeInput, signal: AbortSignal) {
    return this.scope(record.name).start(record, payload, signal);
  }
  stop(record: ProjectServiceRecord, log?: (text: string) => void) { return this.scope(record.name).stop(record, log); }
}

export class ProjectMainScope extends ProjectProcessScope<ProjectMainRecord> {
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'main' }, projectMainRecordSchema, machines.live.get(id));
  }
  intent(bootId: string) { return this.newIntent(projectMainBinding(this.project), bootId); }
}

/** A separate namespace reuses the proven service UUID domain without reserving user service names. */
export class ProjectBrowserIdeScope extends ProjectProcessScope<ProjectBrowserIdeRecord> {
  constructor(machines: Machines, id: string, project: Project, expiresAt?: string) {
    super(machines, id, project, { kind: 'service', name: 'browser-ide', namespace: 'browser-ide',
      ...(expiresAt ? { deadline: Math.floor(Date.parse(expiresAt) / 1000) } : {}) },
      projectBrowserIdeRecordSchema, machines.live.get(id));
  }
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('浏览器 IDE 受保护正文与原记录不符', 409, 'BROWSER_IDE_SCOPE_CHANGED');
    }
    return status;
  }
}

/** Notebook owns a separate receipt namespace and the complete service UUID domain. */
export class ProjectNotebookScope extends ProjectProcessScope<ProjectNotebookRecord> {
  constructor(machines: Machines, id: string, project: Project) {
    super(machines, id, project, { kind: 'service', name: 'notebook', namespace: 'notebook' },
      projectNotebookRecordSchema, machines.live.get(id));
  }
  async status(signal?: AbortSignal, payloadSha256?: string) {
    const status = await super.status(signal);
    if (payloadSha256 !== undefined) {
      const transport = status.record && await this.transport(status.record);
      if (!/^[a-f0-9]{64}$/.test(payloadSha256) || !transport || transport.sha256 !== payloadSha256)
        throw new AppError('Notebook 受保护正文与原记录不符', 409, 'NOTEBOOK_SCOPE_CHANGED');
    }
    return status;
  }
}
