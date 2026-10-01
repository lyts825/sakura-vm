import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { envPrefix, prepareProjectScopeTools } from './project-services.ts';
import { ProjectMainScope, projectMainBinding, projectMainScopePaths, type ProjectMainRecord } from './project-service-scope.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import { writeStore } from './local-store.ts';

export const mainSession = (project: Project) => projectMainScopePaths(project).session;
export const mainLog = (project: Project) => `/tmp/${mainSession(project)}.log`;
export async function legacyMainStatus(machines: Machines, id: string, project: Project, signal?: AbortSignal) {
  const result = await machines.exec(id, `# SAKURA_PROJECT_MAIN_LEGACY_STATUS\n` +
    `if command -v tmux >/dev/null && tmux has-session -t =${mainSession(project)} 2>/dev/null; then echo unmanaged; else echo absent; fi`,
    10000, signal);
  if (result.code !== 0 || !['unmanaged', 'absent'].includes(result.stdout.trim()))
    throw new AppError('项目主命令旧会话状态未确认', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
  return result.stdout.trim() as 'unmanaged' | 'absent';
}
const unmanaged = () => new AppError('旧项目主命令 tmux 缺少可验证归属；请管理员检查并关闭旧会话及其实际后代后重新启动，未自动停止任何进程',
  409, 'PROJECT_MAIN_SCOPE_UNMANAGED');

export async function runProjectMain(machines: Machines, id: string, project: Project,
  log: (text: string) => void, signal: AbortSignal, prepare: () => Promise<void>) {
  if (!project.command.trim()) throw new AppError('请先保存项目启动命令');
  await prepareProjectScopeTools(machines, id, signal, 'main');
  const scope = new ProjectMainScope(machines, id, project);
  const precheck = async () => {
    const state = await scope.status(signal);
    if (state.status === 'running') {
      if (state.record?.binding !== projectMainBinding(project))
        throw new AppError('项目主命令启动配置已改变，请先停止并重建', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
      log('项目已经运行；如需应用新的启动配置，请先停止项目\n');
      return null;
    }
    if (state.status === 'prepared' || state.status === 'unconfirmed')
      throw new AppError('项目主命令上次启动尚未确认，请先停止并重建', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    if (state.status === 'exited')
      throw new AppError('项目主命令主 pane 已退出，请先停止清理仍归属此运行的全部后代', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    return state;
  };
  if (!await precheck()) return;
  await prepare();
  const state = await precheck();
  if (!state) return;
  const intent = scope.intent(state.bootId);
  try {
    await scope.start(intent,
      `${projectNetworkCommand(project, `${envPrefix(project.environment)}\n${project.command}`)} > ${quote(mainLog(project))} 2>&1`, signal);
    await delay(1000, undefined, { signal });
    if ((await scope.status(signal)).status !== 'running')
      throw new AppError('项目启动命令已退出，请检查日志', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    log('项目主命令已启动\n');
  } catch (error) {
    try { await scope.stop(intent, log); }
    catch (cleanupError) {
      throw new AppError(`项目主命令启动失败：${error instanceof Error ? error.message : String(error)}；` +
        `回滚清理未确认：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      503, 'PROJECT_MAIN_CLEANUP_FAILED');
    }
    throw error;
  }
}
function rebootStopProbe(project: Project, record: ProjectMainRecord) {
  const request = { op: 'probe-reboot', ...projectMainScopePaths(project), record };
  // This probe never signals a process. The per-project lock also belongs to
  // the normal scope helper, so a new guest run cannot be mistaken for absence.
  const source = `import fcntl,json,os,stat,subprocess
request=json.loads(${JSON.stringify(JSON.stringify(request))})
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
if boot==request['record']['bootId']:
 print(json.dumps({'bootId':boot,'retired':False}))
else:
 def refuse(message): raise RuntimeError(message)
 folder=request['guest']
 for path in ['/run/sakura-project-main',folder.rsplit('/',1)[0],folder]:
  try: os.mkdir(path,0o700)
  except FileExistsError: pass
  info=os.lstat(path)
  if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: refuse('项目主命令归属目录无法核对')
 lock=os.open(folder+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 info=os.fstat(lock)
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: refuse('项目主命令归属锁无法核对')
 fcntl.flock(lock,fcntl.LOCK_EX)
 if os.path.lexists(folder+'/owner.json'): refuse('新 boot 已有项目主命令归属，拒绝旧运行停止')
 if os.path.lexists('/sys/fs/cgroup/'+request['record']['scopeName']): refuse('新 boot 已有同路径 cgroup，拒绝旧运行停止')
 result=subprocess.run(['/usr/bin/tmux','has-session','-t','='+request['session']],capture_output=True,text=True)
 if result.returncode==0: refuse('新 boot 已有同名 pane，拒绝旧运行停止')
 if not any(text in result.stderr for text in ["can't find session",'no server running','No such file or directory']): refuse('新 boot 的 tmux 状态无法核对：'+result.stderr.strip())
 print(json.dumps({'bootId':boot,'retired':True}))
`;
  return '# SAKURA_PROJECT_MAIN_REBOOT_STOP\n' +
    '# SAKURA_PROJECT_MAIN_REQUEST=' + Buffer.from(JSON.stringify(request)).toString('base64') + '\n' +
    `/usr/bin/python3 -I -S -c ${quote(source)}`;
}
async function confirmRebootedMainStop(machines: Machines, id: string, project: Project,
  scope: ProjectMainScope, record: ProjectMainRecord, log: (text: string) => void, instance: object | undefined) {
  const unchanged = async () => {
    if (!instance || machines.live.get(id) !== instance)
      throw new AppError('客户机 live 实例已改变，拒绝旧项目主命令操作', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    const saved = await scope.metadata();
    if (machines.live.get(id) !== instance)
      throw new AppError('客户机 live 实例已改变，拒绝旧项目主命令操作', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    if (!saved || JSON.stringify({ ...saved, phase: record.phase }) !== JSON.stringify(record) ||
        (saved.phase !== record.phase && saved.phase !== 'stopped'))
      throw new AppError('主机项目主命令完整归属已改变，拒绝旧运行停止', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
    return saved;
  };
  let failure: unknown;
  for (let attempt = 0; attempt < 3; ++attempt) {
    try {
      await unchanged();
      const result = await machines.exec(id, rebootStopProbe(project, record), 10000);
      const saved = await unchanged();
      if (result.code !== 0) throw new Error(result.stderr.trim() || '项目主命令重启归属回执未确认');
      const response = z.object({ bootId: z.uuid(), retired: z.boolean() }).strict().parse(JSON.parse(result.stdout));
      if (response.retired !== (response.bootId !== record.bootId))
        throw new Error('项目主命令重启归属回执的 boot 状态不符');
      if (!response.retired) return false;
      if (saved.phase !== 'stopped') await writeStore(scope.receipt(), { ...saved, phase: 'stopped' });
      await unchanged();
      log('项目主命令所属旧 boot 已结束；未向新 boot 进程发送停止信号\n');
      return true;
    } catch (error) {
      failure = error;
      log(`项目主命令重启归属核对第 ${attempt + 1} 次未确认：${error instanceof Error ? error.message : String(error)}\n`);
      if (machines.live.get(id) !== instance) break;
      if (attempt < 2) await delay(250 * (attempt + 1));
    }
  }
  throw new AppError(`项目主命令清理未确认：${failure instanceof Error ? failure.message : String(failure)}；` +
    `已保留运行记录 ${scope.receipt()}`, 503, 'PROJECT_MAIN_CLEANUP_FAILED');
}
export async function stopProjectMain(machines: Machines, id: string, project: Project,
  log: (text: string) => void, signal?: AbortSignal) {
  const instance = machines.live.get(id);
  const scope = new ProjectMainScope(machines, id, project);
  if (!await scope.hasReceipt()) {
    if (await legacyMainStatus(machines, id, project, signal) === 'unmanaged') throw unmanaged();
    return;
  }
  signal?.throwIfAborted();
  const record = await scope.metadata();
  if (!record) throw new AppError('项目主命令归属记录已缺失，停止未确认', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
  if (await confirmRebootedMainStop(machines, id, project, scope, record, log, instance)) return;
  await scope.stop(record, log);
  log('项目主命令已停止\n');
}
