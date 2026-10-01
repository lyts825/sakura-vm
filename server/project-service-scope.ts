import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
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
const responseSchema = z.object({
  status: z.enum(['absent', 'prepared', 'running', 'exited', 'stopped', 'unconfirmed', 'unmanaged']),
  bootId: z.uuid(),
  record: projectServiceRecordSchema.nullable(),
}).strict().superRefine((response, ctx) => {
  if (['prepared', 'running', 'exited', 'stopped', 'unconfirmed'].includes(response.status) && !response.record)
    ctx.addIssue({ code: 'custom', message: '服务状态缺少可验证归属记录' });
});
export type ProjectServiceStatus = z.infer<typeof responseSchema>;
type Operation = 'status' | 'prepare' | 'start' | 'commit' | 'stop';
export function projectServiceScopePaths(project: Project, name: string) {
  const projectId = projectIdSchema.parse(project._workspace || 'default');
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).parse(name);
  return { projectId, name,
    session: `sakura-service-${projectId === 'default' ? '' : projectId + '-'}${name}`,
    guest: `/run/sakura-project-services/${projectId}/${name}`,
  };
}
export function projectServiceBinding(project: Project, service: ProjectService) {
  return createHash('sha256').update(JSON.stringify([
    project._workspace || 'default', project.directory, project.networkIsolation || 'host',
    project.environment || {}, service.name, service.command, service.environment || {},
  ])).digest('hex');
}

// The helper and the pane launcher run with isolated Python before any project
// environment or command. A persistent service deliberately has no task timeout.
const helper = `import fcntl,json,os,re,signal,stat,subprocess,sys,tempfile,time
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
folder=request['guest']; owner_file=folder+'/owner.json'; cancel_file=folder+'/cancel'
def refuse(message): raise RuntimeError(message)
def trusted_directory(path):
 try: os.mkdir(path,0o700)
 except FileExistsError: pass
 info=os.lstat(path)
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: refuse('服务归属目录权限无法核对')
for path in ['/run/sakura-project-services',folder.rsplit('/',1)[0],folder]: trusted_directory(path)
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
 fields={'version','projectId','name','session','runId','bootId','scopeName','inode','binding','phase','sessionId','paneId','panePid','paneStartTicks'}
 if not isinstance(record,dict) or set(record)!=fields or record['version']!=1: refuse('服务归属记录不完整')
 if record['projectId']!=request['projectId'] or record['name']!=request['name'] or record['session']!=request['session']: refuse('服务归属项目不符')
 if not isinstance(record['runId'],str) or not re.fullmatch('[a-f0-9-]{36}',record['runId']) or record['scopeName']!='sakura-service-'+record['runId']: refuse('服务 cgroup 路径无法核对')
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
 pane_script=request['paneScript']
 pane_file=folder+'/pane-'+record['runId']+'.py'
 script_file=os.open(pane_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(script_file,'w') as stream: stream.write(pane_script); stream.flush(); os.fsync(stream.fileno())
 created=subprocess.run(['/usr/bin/tmux','new-session','-d','-s',request['session'],'-c',request['directory'],'-P','-F','#{session_id} #{pane_id} #{pane_pid}', '/usr/bin/python3','-I','-S',pane_file],capture_output=True,text=True)
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
 record['phase']='running'; write_owner(record); result('running',record)
def stop():
 fcntl.flock(lock,fcntl.LOCK_EX)
 expected=request['record']
 if expected['bootId']!=boot: refuse('客户机 boot 身份已改变，拒绝旧服务停止')
 record=read_owner()
 if record is None or (record['runId']!=expected['runId'] and record['phase']=='stopped'):
  if os.path.lexists(scope_path(expected)) or tmux_panes(): refuse('服务归属未知，拒绝未核对停止')
  if record is not None and os.path.lexists(scope_path(record)): refuse('旧服务 cgroup 已被替换，拒绝覆盖归属')
  cancel(expected); stopped=dict(expected,phase='stopped'); write_owner(stopped); result('stopped',stopped); return
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
  try: os.unlink(folder+'/pane-'+record['runId']+'.py')
  except FileNotFoundError: pass
  record['phase']='stopped'; write_owner(record); result('stopped',record)
 finally:
  if pidfd is not None: os.close(pidfd)
  if descriptor is not None: os.close(descriptor)
def pane():
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  fcntl.flock(lock,fcntl.LOCK_EX)
  record=read_owner(); expect_owner(record)
  if cancelled(record) or record['phase']=='stopped': refuse('服务启动已取消；项目代码未执行')
  if record['panePid'] is not None:
   if record['panePid']!=os.getpid() or record['paneId']!=os.environ.get('TMUX_PANE') or proc_fields(os.getpid())[19]!=record['paneStartTicks']: refuse('当前 pane 不属于本次启动')
   descriptor=scope_descriptor(record)
   if descriptor is None: refuse('服务 cgroup 已缺失；项目代码未执行')
   try:
    with open('/proc/self/fd/'+str(descriptor)+'/cgroup.procs','w') as stream: stream.write(str(os.getpid()))
   finally: os.close(descriptor)
   if '0::/'+record['scopeName'] not in open('/proc/self/cgroup').read().splitlines(): refuse('服务未进入已登记 cgroup；项目代码未执行')
   if record['phase']=='running':
    fcntl.flock(lock,fcntl.LOCK_UN)
    os.close(lock)
    os.execv('/bin/sh',['sh','-c',request['payload']])
  fcntl.flock(lock,fcntl.LOCK_UN); time.sleep(0.05)
 refuse('服务提交等待超时；项目代码未执行；归属记录已保留')
try:
 {'status':status,'prepare':prepare,'start':launch,'commit':commit,'stop':stop,'pane':pane}[request['op']]()
except Exception as error:
 print('SAKURA_SERVICE_SCOPE_REFUSED: '+str(error),file=sys.stderr); sys.exit(73)
`;

function python(request: object) {
  return `request=json.loads(${JSON.stringify(JSON.stringify(request))})\n`;
}
export function projectServiceScopeCommand(project: Project, name: string, op: Operation,
  record?: ProjectServiceRecord, payload?: string) {
  const paths = projectServiceScopePaths(project, name);
  const request: any = { op, ...paths, ...(record ? { record } : {}) };
  if (op === 'start') {
    const paneRequest = { op: 'pane', ...paths, record, payload };
    request.directory = project.directory;
    request.paneScript = 'import json\n' + python(paneRequest) + helper;
  }
  const source = 'import json\n' + python(request) + helper;
  const { paneScript: _paneScript, ...metadata } = request;
  return `# SAKURA_PROJECT_SERVICE_${op.toUpperCase()}\n` +
    `# SAKURA_PROJECT_SERVICE_REQUEST=${Buffer.from(JSON.stringify(metadata)).toString('base64')}\n` +
    `set -eu\nif [ ! -x /usr/bin/python3 ] || [ ! -x /usr/bin/tmux ]; then ` +
    `echo 'SAKURA_SERVICE_SCOPE_UNAVAILABLE: 服务需要 python3、tmux 和可写 cgroup v2；项目代码未执行' >&2; exit 73; fi\n` +
    `/usr/bin/python3 -I -S -c ${quote(source)}`;
}

export class ProjectServiceScopes {
  private readonly instance: object | undefined;
  constructor(private machines: Machines, private id: string, private project: Project) {
    this.instance = machines.live.get(id);
  }
  private assertLive() {
    if (!this.instance || this.machines.live.get(this.id) !== this.instance)
      throw new AppError('客户机 live 实例已改变，拒绝旧服务操作', 409, 'SERVICE_SCOPE_CHANGED');
  }
  receipt(name: string) {
    const p = projectServiceScopePaths(this.project, name);
    return join(vmDir(this.id), 'project-services', p.projectId, name, 'runtime.json');
  }
  async hasReceipt(name: string) {
    try { await lstat(this.receipt(name)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  async metadata(name: string) {
    try {
      const saved = await readStore<unknown>(this.receipt(name), () => null);
      return saved === null ? null : projectServiceRecordSchema.parse(saved);
    }
    catch { throw new AppError('主机服务归属记录无法核对', 409, 'SERVICE_SCOPE_CHANGED'); }
  }
  private async save(record: ProjectServiceRecord) {
    this.assertLive();
    const file = this.receipt(record.name);
    await regularDirectory(join(file, '..'));
    await writeStore(file, projectServiceRecordSchema.parse(record));
    this.assertLive();
  }
  private async execute(name: string, op: Operation, record?: ProjectServiceRecord,
    payload?: string, signal?: AbortSignal) {
    this.assertLive();
    const result = await this.machines.exec(this.id,
      projectServiceScopeCommand(this.project, name, op, record, payload), 30_000, signal);
    this.assertLive();
    if (result.code !== 0)
      throw new AppError(result.stderr.trim() || `无法${op}项目服务`, 409,
        result.stderr.includes('SAKURA_SERVICE_SCOPE_UNAVAILABLE') ? 'SERVICE_SCOPE_UNAVAILABLE' : 'SERVICE_SCOPE_CHANGED');
    let response: ProjectServiceStatus;
    try { response = responseSchema.parse(JSON.parse(result.stdout)); }
    catch { throw new AppError('服务归属回执无法核对，拒绝继续操作', 409, 'SERVICE_SCOPE_CHANGED'); }
    if (response.record && response.record.bootId !== response.bootId)
      throw new AppError('服务回执 boot 身份不符', 409, 'SERVICE_SCOPE_CHANGED');
    if (record && response.bootId !== record.bootId)
      throw new AppError('客户机 boot 身份已改变', 409, 'SERVICE_SCOPE_CHANGED');
    if (record && response.record && (response.record.runId !== record.runId || response.record.scopeName !== record.scopeName))
      throw new AppError('客体回执与本次服务 run 不符', 409, 'SERVICE_SCOPE_CHANGED');
    if (record && response.record) this.sameOwner(record, response.record);
    return response;
  }
  private sameOwner(expected: ProjectServiceRecord, actual: ProjectServiceRecord) {
    for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
      if (expected[key] !== actual[key])
        throw new AppError('服务运行归属已改变，拒绝旧服务操作', 409, 'SERVICE_SCOPE_CHANGED');
    for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
      if (expected[key] !== null && expected[key] !== actual[key])
        throw new AppError('服务 cgroup 或 pane 归属已改变，拒绝旧服务操作', 409, 'SERVICE_SCOPE_CHANGED');
  }
  async status(name: string, signal?: AbortSignal) {
    const status = await this.execute(name, 'status', undefined, undefined, signal);
    if (status.status === 'unmanaged')
      throw new AppError('旧 tmux 服务缺少可验证归属，请明确关闭旧会话后重新启动；未自动停止任何进程', 409, 'SERVICE_SCOPE_UNMANAGED');
    const saved = await this.metadata(name);
    if (saved && status.record) this.sameOwner(saved, status.record);
    if (saved && !status.record && status.status === 'absent' && saved.phase !== 'stopped' && saved.bootId === status.bootId)
      return { ...status, status: 'unconfirmed' as const, record: saved };
    return status;
  }
  intent(service: ProjectService, bootId: string): ProjectServiceRecord {
    const paths = projectServiceScopePaths(this.project, service.name), runId = randomUUID();
    return { version: 1, projectId: paths.projectId, name: service.name, session: paths.session,
      runId, bootId, scopeName: 'sakura-service-' + runId, inode: null,
      binding: projectServiceBinding(this.project, service), phase: 'intent',
      sessionId: null, paneId: null, panePid: null, paneStartTicks: null };
  }
  async start(record: ProjectServiceRecord, payload: string, signal: AbortSignal) {
    await this.save(record);
    signal.throwIfAborted();
    const prepared = await this.execute(record.name, 'prepare', record, undefined, signal);
    if (prepared.status !== 'prepared' || !prepared.record)
      throw new AppError('服务 prepared 回执不完整', 409, 'SERVICE_SCOPE_CHANGED');
    await this.save(prepared.record);
    const pane = await this.execute(record.name, 'start', prepared.record, payload, signal);
    if (pane.status !== 'prepared' || !pane.record?.panePid)
      throw new AppError('服务 pane 回执不完整', 409, 'SERVICE_SCOPE_CHANGED');
    await this.save(pane.record);
    const committed = await this.execute(record.name, 'commit', pane.record, undefined, signal);
    if (committed.status !== 'running' || !committed.record)
      throw new AppError('服务提交回执未确认', 409, 'SERVICE_SCOPE_CHANGED');
    await this.save(committed.record);
    return committed.record;
  }
  async stop(record: ProjectServiceRecord, log?: (text: string) => void) {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; ++attempt) {
      try {
        this.assertLive();
        const stored = await readStore<ProjectServiceRecord | null>(this.receipt(record.name), () => null);
        let expected = record;
        if (stored) {
          const current = projectServiceRecordSchema.parse(stored);
          // An interrupted prepare can leave the host intent less complete than
          // the guest's root-owned receipt. Compare every identity both sides
          // know, then carry the fuller identity into the guarded guest stop.
          for (const key of ['runId', 'bootId', 'scopeName', 'binding'] as const)
            if (current[key] !== record[key])
              throw new AppError('主机服务 run 已改变，拒绝旧回滚', 409, 'SERVICE_SCOPE_CHANGED');
          for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
            if (current[key] !== null && record[key] !== null && current[key] !== record[key])
              throw new AppError('主机服务 cgroup 或 pane 已改变，拒绝旧回滚', 409, 'SERVICE_SCOPE_CHANGED');
          expected = { ...record, inode: current.inode ?? record.inode,
            sessionId: current.sessionId ?? record.sessionId, paneId: current.paneId ?? record.paneId,
            panePid: current.panePid ?? record.panePid, paneStartTicks: current.paneStartTicks ?? record.paneStartTicks };
        }
        const stopped = await this.execute(record.name, 'stop', expected);
        if (stopped.status !== 'stopped' || !stopped.record)
          throw new AppError('服务全 scope 停止未确认', 409, 'SERVICE_SCOPE_CHANGED');
        await this.save(stopped.record);
        return;
      } catch (error) {
        failure = error;
        log?.(`服务 ${record.name} 清理第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);
        if (this.machines.live.get(this.id) !== this.instance) break;
        if (attempt < 2) await delay(250 * (attempt + 1));
      }
    }
    throw new AppError(`服务 ${record.name} 清理未确认：${failure instanceof Error ? failure.message : String(failure)}；` +
      `已保留运行记录 ${this.receipt(record.name)}`, 503, 'SERVICE_CLEANUP_FAILED');
  }
}
