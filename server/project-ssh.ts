import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import type { Project, Workspaces } from './workspaces.ts';
import { quote } from './files.ts';
import { readStore, writeStore, regularDirectory } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { envPrefix } from './project-services.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkCommand,
  projectNetworkNamespace,
} from './project-network-isolation.ts';
import { ProjectNetworkBridges } from './project-network-bridges.ts';
import { createSshKey } from './seed.ts';
import { freePort } from './qmp.ts';
import { guestTask } from './guest-task.ts';
import ssh2 from 'ssh2';
import { secureSshPaths } from './ssh-files.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function projectSshPaths(projectId: string) {
  const key = projectIdSchema.parse(projectId),
    config = `/etc/sakura/ssh/${key}`;
  return {
    key,
    config,
    home: `/var/lib/sakura/ssh/${key}`,
    unit: `sakura-ssh-${key}.service`,
    unitPath: `/etc/systemd/system/sakura-ssh-${key}.service`,
    openrcUnit: `sakura-ssh-${key}`,
    openrcPath: `/etc/init.d/sakura-ssh-${key}`,
    runtime: `/run/sakura-project-ssh/${key}`,
    openrcGroup: `/openrc.sakura-ssh-${key}`,
  };
}
export const projectSshBinding = (project: Project) =>
  digest(
    JSON.stringify([project._workspace || 'default', project.directory, project.networkIsolation || 'host']),
  );

function servicePresent(p: ReturnType<typeof projectSshPaths>) {
  return (
    `[ -d ${p.config} ] || [ -e ${p.unitPath} ] || [ -e ${p.openrcPath} ] || ` +
    `[ -d ${p.runtime} ] || [ -d /sys/fs/cgroup${p.openrcGroup} ] || ` +
    `{ command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ${p.unit}; }`
  );
}

/** Proc evidence is independent of a potentially damaged OpenRC receipt. */
function projectSshMainScan(p: ReturnType<typeof projectSshPaths>) {
  return (
    `def project_mains():\n` +
    ` result=[]\n` +
    ` for entry in glob.glob('/proc/[0-9]*/stat'):\n` +
    `  directory=entry.rsplit('/',1)[0]\n` +
    `  try:\n` +
    `   fields=open(entry).read().rsplit(')',1)[1].split()\n` +
    `   if fields[0]=='Z': continue\n` +
    `   args=open(directory+'/cmdline','rb').read().decode(errors='replace').replace(chr(0),' ').split()\n` +
    `   fixed=${JSON.stringify(p.config + '/sshd_config')}\n` +
    `   if not any((arg=='-f' and index+1<len(args) and args[index+1]==fixed) or arg=='-f'+fixed for index,arg in enumerate(args)): continue\n` +
    `   executable=os.readlink(directory+'/exe')\n` +
    `   if executable.endswith(' (deleted)'): executable=executable[:-10]\n` +
    `   if executable=='/usr/sbin/sshd': result.append(int(directory.rsplit('/',1)[1]))\n` +
    `  except (FileNotFoundError,ProcessLookupError): pass\n` +
    ` return result\n`
  );
}

/** Includes detached children that retain the service cgroup after their SSH channel closes. */
export function projectSshBusyScript(projectId: string) {
  const p = projectSshPaths(projectId);
  return `if ${servicePresent(p)}; then python3 -I -S -c ${quote(
    `import glob,json,os\n` +
      projectSshMainScan(p) +
      `units=${JSON.stringify(['/' + p.unit, p.openrcGroup])}\n` +
      `busy=bool(project_mains())\n` +
      `for path in glob.glob('/proc/[0-9]*/cgroup'):\n` +
      ` try:\n  groups=open(path).read().splitlines()\n` +
      `  if any(g.split(':',2)[-1].endswith(unit) or unit+'/' in g.split(':',2)[-1] for g in groups for unit in units): busy=True; break\n` +
      ` except (OSError,ProcessLookupError): pass\n` +
      `try:\n` +
      ` owner=json.load(open(${JSON.stringify(p.runtime + '/owner.json')}))\n` +
      ` pid=owner['pid']; fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()\n` +
      ` if owner['bootId']==open('/proc/sys/kernel/random/boot_id').read().strip() and owner['startTicks']==fields[19] and fields[0]!='Z': busy=True\n` +
      `except (OSError,ValueError,KeyError,TypeError): pass\n` +
      `if busy: print('SAKURA_PROJECT_SSH_BUSY')`,
  )}; fi`;
}

export const projectSshRecordSchema = z
  .object({
    version: z.literal(1),
    manager: z.enum(['systemd', 'openrc']).optional(),
    runId: z.uuid(),
    projectId: projectIdSchema,
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    guestPort: z.number().int().min(1024).max(65535),
    environment: z.string().regex(/^[a-f0-9]{64}$/),
    hostPublicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/),
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict()
  .superRefine((record, context) => {
    const p = projectSshPaths(record.projectId);
    const required = [
      p.config + '/command',
      p.config + '/sshd_config',
      p.config + '/authorized_keys',
      p.config + '/hostkey',
      ...(record.manager === 'openrc' ? [p.openrcPath, p.config + '/launch.py'] : [p.unitPath]),
    ];
    if (
      Object.keys(record.files).length !== required.length ||
      required.some((path) => !(path in record.files))
    )
      context.addIssue({ code: 'custom', message: '项目 SSH 文件绑定不完整' });
  });
type Record = z.infer<typeof projectSshRecordSchema>;
type Manager = 'systemd' | 'openrc';
const statusSchema = z
  .object({
    present: z.boolean(),
    running: z.boolean(),
    valid: z.boolean(),
    processes: z.number().int().nonnegative(),
    reason: z.string().nullable(),
  })
  .strict();
type Status = z.infer<typeof statusSchema>;
const environmentHash = (project: Project) =>
  digest(JSON.stringify(Object.entries(project.environment || {}).sort(([a], [b]) => a.localeCompare(b))));

function openrcCgroupCheck(p: ReturnType<typeof projectSshPaths>) {
  return (
    `group=${JSON.stringify(p.openrcGroup)}; base='/sys/fs/cgroup'; path=base+group\n` +
    `def require_root():\n` +
    ` if os.path.islink(base): raise ValueError('项目 SSH cgroup 根目录不符')\n` +
    ` mounted=False\n` +
    ` for row in open('/proc/self/mountinfo').read().splitlines():\n` +
    `  fields=row.split(); separator=fields.index('-')\n` +
    `  if fields[4]==base and fields[3]=='/' and fields[separator+1]=='cgroup2': mounted=True\n` +
    ` if not mounted or not os.path.isfile(base+'/cgroup.controllers'): raise ValueError('项目 SSH 需要真实 cgroup v2 统一层级')\n` +
    ` if os.path.lexists(path) and (os.path.islink(path) or not os.path.isdir(path)): raise ValueError('项目 SSH cgroup 路径不符')\n`
  );
}

function openrcStopScript(p: ReturnType<typeof projectSshPaths>) {
  return (
    `import glob,json,os,time\n` +
    openrcCgroupCheck(p) +
    projectSshMainScan(p) +
    `def members():\n` +
    ` result=[]\n` +
    ` for proc in glob.glob('/proc/[0-9]*/cgroup'):\n` +
    `  try:\n` +
    `   if any(row.startswith('0::') and (row[3:]==group or row[3:].startswith(group+'/')) for row in open(proc).read().splitlines()): result.append(int(proc.split('/')[2]))\n` +
    `  except (OSError,ProcessLookupError): pass\n` +
    ` return result\n` +
    `owned=members()\n` +
    `if os.getpid() in owned: raise ValueError('不能从被停止的项目 cgroup 内执行清理')\n` +
    `if owned and not os.path.isdir(path): raise ValueError('项目 SSH cgroup 无法核对，拒绝放行')\n` +
    `if os.path.lexists(path):\n` +
    ` require_root()\n` +
    ` if not os.path.isfile(path+'/cgroup.kill'): raise ValueError('项目 SSH 需要 cgroup.kill 清理全部子进程')\n` +
    ` with open(path+'/cgroup.kill','w') as stream: stream.write('1')\n` +
    ` deadline=time.monotonic()+10\n` +
    ` while 'populated 1' in open(path+'/cgroup.events').read():\n` +
    `  if time.monotonic()>=deadline: raise ValueError('项目 SSH 子进程尚未停止')\n` +
    `  time.sleep(0.05)\n` +
    // cgroup.events ignores zombies. Keep the kernel group until PID 1 has
    // reaped its dead members, so a completed stop also removes their /proc records.
    ` while members():\n` +
    `  if time.monotonic()>=deadline: raise ValueError('项目 SSH 子进程尚未回收')\n` +
    `  time.sleep(0.05)\n` +
    ` for folder,children,files in os.walk(path,topdown=False): os.rmdir(folder)\n` +
    `owner=None\n` +
    `try: owner=json.load(open(${JSON.stringify(p.runtime + '/owner.json')}))\n` +
    `except (FileNotFoundError,ProcessLookupError,json.JSONDecodeError,UnicodeDecodeError): pass\n` +
    `if isinstance(owner,dict) and isinstance(owner.get('pid'),int) and not isinstance(owner['pid'],bool) and owner['pid']>0 and isinstance(owner.get('bootId'),str) and isinstance(owner.get('startTicks'),str):\n` +
    ` fields=None\n` +
    ` try: fields=open('/proc/'+str(owner['pid'])+'/stat').read().rsplit(')',1)[1].split()\n` +
    ` except (FileNotFoundError,ProcessLookupError): pass\n` +
    ` if fields is not None and owner['bootId']==open('/proc/sys/kernel/random/boot_id').read().strip() and owner['startTicks']==fields[19] and fields[0]!='Z': raise ValueError('项目 SSH 主进程仍存活，拒绝放行')\n` +
    `if project_mains(): raise ValueError('项目 SSH 配置对应的主进程仍在 cgroup 外存活，拒绝放行')\n` +
    `for state in ['started','starting','stopping','inactive','failed','wasinactive']:\n` +
    ` marker='/run/openrc/'+state+${JSON.stringify('/' + p.openrcUnit)}\n` +
    ` if os.path.lexists(marker): os.unlink(marker)\n`
  );
}

function openrcLauncher(project: Project, runId: string) {
  const p = projectSshPaths(project._workspace || 'default'),
    namespace = projectNetworkNamespace(project);
  return (
    `#!/usr/bin/python3\n` +
    `import json,os,stat,sys,tempfile\n` +
    `if sys.argv[1:]==['--stop']:\n` +
    openrcStopScript(p)
      .split('\n')
      .filter(Boolean)
      .map((line) => ' ' + line)
      .join('\n') +
    `\n sys.exit(0)\n` +
    openrcCgroupCheck(p) +
    `require_root()\n` +
    `if not os.path.isfile(path+'/cgroup.kill') or '0::'+group not in open('/proc/self/cgroup').read().splitlines(): raise ValueError('OpenRC 没有建立项目 SSH 的真实 cgroup')\n` +
    `runtime=${JSON.stringify(p.runtime)}\n` +
    `for directory in ['/run','/run/sakura-project-ssh',runtime]:\n` +
    ` info=os.lstat(directory)\n` +
    ` if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: raise ValueError('项目 SSH 运行目录权限不符')\n` +
    `owner={'version':1,'manager':'openrc','service':${JSON.stringify(p.openrcUnit)},'runId':${JSON.stringify(runId)},'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),'pid':os.getpid(),'startTicks':open('/proc/self/stat').read().rsplit(')',1)[1].split()[19],'cgroup':group}\n` +
    `descriptor,temporary=tempfile.mkstemp(dir=runtime,prefix='.owner-',suffix='.new')\n` +
    `with os.fdopen(descriptor,'w') as stream: json.dump(owner,stream); stream.flush(); os.fsync(stream.fileno())\n` +
    `os.replace(temporary,runtime+'/owner.json')\n` +
    `directory=os.open(runtime,os.O_DIRECTORY); os.fsync(directory); os.close(directory)\n` +
    `command=${JSON.stringify(namespace ? ['/usr/bin/nsenter', '--net=/run/netns/' + namespace, '--', '/usr/sbin/sshd', '-D', '-e', '-f', p.config + '/sshd_config'] : ['/usr/sbin/sshd', '-D', '-e', '-f', p.config + '/sshd_config'])}\n` +
    `os.execve(command[0],command,{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','SAKURA_PROJECT_SSH_ID':${JSON.stringify(runId)}})\n`
  );
}

function openrcService(project: Project) {
  const p = projectSshPaths(project._workspace || 'default');
  return (
    `#!/sbin/openrc-run\ndescription="Sakura project SSH ${p.key}"\n` +
    `depend() { need cgroups; after net; }\n` +
    `start() {\n ebegin "Starting Sakura project SSH ${p.key}"\n` +
    ` start-stop-daemon --start --background --make-pidfile --pidfile ${p.runtime}/pid --stdout ${p.runtime}/log --stderr ${p.runtime}/log --exec /usr/bin/python3 -- -I -S ${p.config}/launch.py\n eend $?\n}\n` +
    `stop() {\n ebegin "Stopping Sakura project SSH ${p.key}"\n` +
    ` printf '%s\\n' "$$" > /sys/fs/cgroup/cgroup.procs || return 1\n` +
    ` /usr/bin/python3 -I -S ${p.config}/launch.py --stop\n eend $?\n}\n` +
    `status() { service_started; }\n`
  );
}

function statusCommand(project: Project, record: Record | null, manager: Manager) {
  const p = projectSshPaths(project._workspace || 'default'),
    namespace = projectNetworkNamespace(project);
  const script =
    `import glob,hashlib,json,os,subprocess\n` +
    projectSshMainScan(p) +
    `unit=${JSON.stringify(p.unit)}; config=${JSON.stringify(p.config)}\n` +
    `manager=${JSON.stringify(manager)}; openrc=${JSON.stringify(p.openrcUnit)}; group=${JSON.stringify(p.openrcGroup)}\n` +
    `expected=${record ? JSON.stringify(record) : 'None'}\n` +
    `out={'present':os.path.exists(config+'/binding.json'),'running':False,'valid':False,'processes':0,'reason':None}\n` +
    `def show(field):\n return subprocess.check_output(['systemctl','show','--value','--property',field,unit],text=True).strip()\n` +
    `try:\n` +
    ` owner=None; pid=0\n` +
    ` owned=[]\n` +
    ` for path in glob.glob('/proc/[0-9]*/cgroup'):\n` +
    `  try:\n` +
    `   groups=open(path).read().splitlines()\n` +
    `   if any((g.split(':',2)[-1].endswith('/'+unit) or '/'+unit+'/' in g.split(':',2)[-1]) if manager=='systemd' else (g.startswith('0::') and (g[3:]==group or g[3:].startswith(group+'/'))) for g in groups): owned.append(int(path.split('/')[2]))\n` +
    `  except (OSError,ProcessLookupError): pass\n` +
    // A malformed receipt must never hide processes proven by the kernel.
    ` out['processes']=len(owned); out['running']=bool(owned)\n` +
    ` if manager=='openrc':\n` +
    `  try:\n` +
    `   mains=project_mains(); out['running']=bool(owned or mains)\n` +
    `  except (OSError,ValueError,IndexError):\n` +
    `   out['running']=True\n` +
    `   raise ValueError('无法核对项目 SSH 主进程，拒绝放行')\n` +
    `  if any(main not in owned for main in mains): raise ValueError('项目 SSH 主进程仍在所属 cgroup 外存活，拒绝放行')\n` +
    ` if manager=='systemd': pid=int(show('MainPID') or '0')\n` +
    ` elif os.path.exists(${JSON.stringify(p.runtime + '/owner.json')}):\n` +
    `  owner=json.load(open(${JSON.stringify(p.runtime + '/owner.json')})); pid=owner['pid']\n` +
    `  if not isinstance(pid,int) or isinstance(pid,bool) or pid<1: raise ValueError('项目 SSH OpenRC PID 记录不符')\n` +
    `  try:\n` +
    `   fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()\n` +
    `   if owner.get('bootId')!=open('/proc/sys/kernel/random/boot_id').read().strip() or owner.get('startTicks')!=fields[19] or fields[0]=='Z': pid=0\n` +
    `  except (FileNotFoundError,ProcessLookupError): pid=0\n` +
    ` out['processes']=len(owned); out['running']=bool(out['running'] or pid)\n` +
    ` if not out['running']: raise ValueError('项目 SSH 尚未启动')\n` +
    ` if expected is None or expected.get('manager','systemd')!=manager or expected['binding']!=${JSON.stringify(projectSshBinding(project))}: raise ValueError('项目 SSH 绑定已变化，请停止并重建')\n` +
    ` if json.load(open(config+'/binding.json'))!=expected: raise ValueError('项目 SSH 启动记录已变化')\n` +
    ` for path,wanted in expected['files'].items():\n` +
    `  if os.path.islink(path) or hashlib.sha256(open(path,'rb').read()).hexdigest()!=wanted: raise ValueError('项目 SSH 配置或密钥已变化')\n` +
    ` if pid not in owned or os.path.realpath('/proc/'+str(pid)+'/exe')!='/usr/sbin/sshd': raise ValueError('项目 SSH 服务进程不符')\n` +
    ` args=open('/proc/'+str(pid)+'/cmdline','rb').read().decode().replace(chr(0),' ')\n` +
    ` if config+'/sshd_config' not in args: raise ValueError('项目 SSH 进程参数不符')\n` +
    // OpenSSH clears its daemon environment during initialization. Check the
    // owning systemd unit's configured start identity instead.
    ` if manager=='systemd':\n` +
    `  if 'SAKURA_PROJECT_SSH_ID='+expected['runId'] not in show('Environment').split(): raise ValueError('项目 SSH 启动标识不符')\n` +
    ` else:\n` +
    openrcCgroupCheck(p)
      .split('\n')
      .filter(Boolean)
      .map((line) => '  ' + line)
      .join('\n') +
    `\n  require_root()\n` +
    `  if owner is None or set(owner)!=set(['version','manager','service','runId','bootId','pid','startTicks','cgroup']) or owner['version']!=1 or owner['manager']!='openrc' or owner['service']!=openrc or owner['runId']!=expected['runId'] or owner['cgroup']!=group: raise ValueError('项目 SSH OpenRC 启动标识不符')\n` +
    `  if owner['startTicks']!=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19]: raise ValueError('项目 SSH OpenRC 进程身份已变化')\n` +
    `  for receipt in [${JSON.stringify(p.runtime + '/owner.json')},${JSON.stringify(p.runtime + '/pid')}]:\n` +
    `   meta=os.lstat(receipt)\n` +
    `   if os.path.islink(receipt) or meta.st_uid!=0 or meta.st_mode & 0o022: raise ValueError('项目 SSH OpenRC 记录权限不符')\n` +
    `  if int(open(${JSON.stringify(p.runtime + '/pid')}).read())!=pid or int(open(config+'/sshd.pid').read())!=pid: raise ValueError('项目 SSH OpenRC PID 记录不符')\n` +
    `  if subprocess.run(['rc-service',openrc,'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0: raise ValueError('项目 SSH OpenRC 服务未登记运行')\n` +
    ` net=os.stat(${JSON.stringify(namespace ? '/run/netns/' + namespace : '/proc/1/ns/net')})\n` +
    ` for child in owned:\n` +
    `  try:\n` +
    `   actual=os.stat('/proc/'+str(child)+'/ns/net')\n` +
    `   if (actual.st_dev,actual.st_ino)!=(net.st_dev,net.st_ino): raise ValueError('项目 SSH 子进程网络不符')\n` +
    `  except FileNotFoundError: pass\n` +
    ` sockets=set()\n` +
    ` for fd in glob.glob('/proc/'+str(pid)+'/fd/*'):\n` +
    `  try: sockets.add(os.readlink(fd))\n` +
    `  except OSError: pass\n` +
    ` listener='0100007F:'+format(expected['guestPort'],'04X')\n` +
    ` if not any(len(row.split())>9 and row.split()[1]==listener and row.split()[3]=='0A' and 'socket:['+row.split()[9]+']' in sockets for row in open('/proc/'+str(pid)+'/net/tcp').read().splitlines()[1:]): raise ValueError('项目 SSH 未持有预期的回环监听')\n` +
    (namespace
      ? ` links=subprocess.check_output(['ip','-n',${JSON.stringify(namespace)},'-o','link','show'],text=True).splitlines()\n` +
        ` if len(links)!=1: raise ValueError('项目 SSH 网络已有额外接口')\n` +
        ` for family in ['-4','-6']:\n` +
        `  if subprocess.check_output(['ip','-n',${JSON.stringify(namespace)},'-o',family,'route','show'],text=True).strip(): raise ValueError('项目 SSH 网络已有额外路由')\n`
      : '') +
    ` out['valid']=True\n` +
    `except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError) as error: out['reason']=str(error) if isinstance(error,ValueError) else '无法核对项目 SSH 服务'\n` +
    `print(json.dumps(out))\n`;
  return (
    `# SAKURA_PROJECT_SSH_STATUS\n` +
    `if ${servicePresent(p)}; then python3 -I -S -c ${quote(script)}; else printf '%s\\n' '${JSON.stringify({ present: false, running: false, valid: false, processes: 0, reason: null })}'; fi`
  );
}

export class ProjectSsh {
  private bridges: ProjectNetworkBridges;
  private endpoints = new Map<string, { port: number; record: Record; project: Project }>();
  private pending = new Set<Promise<unknown>>();
  private controller = new AbortController();
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {
    this.bridges = new ProjectNetworkBridges(machines, async (id, project, signal) => {
      const status = await this.status(id, project, signal);
      if (!status.valid) throw new AppError(status.reason || '项目 SSH 不可用', 409);
    });
  }
  private folder(id: string, projectId: string) {
    return join(vmDir(id), 'project-ssh', projectIdSchema.parse(projectId));
  }
  private async record(id: string, project: Project) {
    try {
      const value = await readStore(
        join(this.folder(id, project._workspace || 'default'), 'runtime.json'),
        () => null,
      );
      return value === null ? null : projectSshRecordSchema.parse(value);
    } catch {
      return null;
    }
  }
  async status(id: string, project: Project, signal?: AbortSignal): Promise<Status> {
    let record = await this.record(id, project),
      environmentError: string | undefined;
    if (this.machines.state(id) !== 'running')
      return { present: !!record, running: false, valid: false, processes: 0, reason: '请先启动或恢复实例' };
    project = await this.workspaces.projects.inScope(id, project._workspace || 'default', () =>
      this.workspaces.config(id),
    );
    if (record) {
      try {
        const resolved = await this.workspaces.projects.inScope(id, project._workspace || 'default', () =>
          this.workspaces.resolvedConfig(id),
        );
        if (record.environment !== environmentHash(resolved)) {
          record = null;
          environmentError = '项目 SSH 环境已变化，请停止并重建';
        }
      } catch {
        record = null;
        environmentError = '无法解析项目 SSH 环境，请检查密钥服务';
      }
    }
    const manager = this.machines.get(id).distro === 'alpine' ? 'openrc' : 'systemd';
    const result = await this.machines.exec(id, statusCommand(project, record, manager), 30_000, signal);
    if (result.code !== 0) throw new AppError('无法读取项目 SSH 状态', 409);
    const status = statusSchema.parse(JSON.parse(result.stdout));
    if (environmentError) {
      status.valid = false;
      status.reason = environmentError;
    }
    if (status.valid && record) {
      try {
        const folder = this.folder(id, record.projectId);
        await regularDirectory(folder);
        const [privateKey, publicKey, knownHosts] = await Promise.all(
          ['id_rsa', 'id_rsa.pub', 'known_hosts'].map(async (name) => {
            const path = join(folder, name);
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid SSH file');
            return readFile(path, 'utf8');
          }),
        );
        const key = ssh2.utils.parseKey(privateKey);
        if (
          key instanceof Error ||
          Array.isArray(key) ||
          key.getPublicSSH().toString('base64') !== publicKey.trim().split(' ')[1] ||
          digest(publicKey.trim() + '\n') !==
            record.files[projectSshPaths(record.projectId).config + '/authorized_keys'] ||
          knownHosts !== `sakura-${id}-${record.projectId} ${record.hostPublicKey}\n`
        )
          throw new Error('changed SSH identity');
      } catch {
        status.valid = false;
        status.reason = '项目 SSH 客户端密钥或主机公钥记录已变化，请停止并重建';
      }
    }
    return status;
  }
  async endpoint(id: string, project: Project, signal?: AbortSignal) {
    const key = `${id}:${project._workspace || 'default'}`,
      record = await this.record(id, project);
    if (!record || !(await this.status(id, project, signal)).valid) {
      await this.bridges.stop(id, project._workspace || 'default');
      this.endpoints.delete(key);
      return null;
    }
    let prior = this.endpoints.get(key);
    if (prior && prior.record.runId !== record.runId) {
      await this.bridges.stop(id, record.projectId);
      this.endpoints.delete(key);
      prior = undefined;
    }
    const port = prior?.port || (await freePort());
    await this.bridges.open(id, project, record.guestPort, port, signal, true);
    this.endpoints.set(key, { port, record, project });
    return {
      port,
      identity: join(this.folder(id, record.projectId), 'id_rsa'),
      knownHosts: join(this.folder(id, record.projectId), 'known_hosts'),
      hostKeyAlias: `sakura-${id}-${record.projectId}`,
    };
  }
  async entries() {
    const result: Array<{
      vmId: string;
      projectId: string;
      port: number;
      identity: string;
      knownHosts: string;
      hostKeyAlias: string;
    }> = [];
    for (const [key, endpoint] of this.endpoints) {
      const id = key.split(':')[0];
      if (this.machines.state(id) !== 'running' || this.machines.incidentLocked(id)) continue;
      const status = await this.status(id, endpoint.project).catch(() => null);
      if (!status?.valid) {
        await this.bridges.stop(id, endpoint.record.projectId);
        this.endpoints.delete(key);
        continue;
      }
      result.push({
        vmId: id,
        projectId: endpoint.record.projectId,
        port: endpoint.port,
        identity: join(this.folder(id, endpoint.record.projectId), 'id_rsa'),
        knownHosts: join(this.folder(id, endpoint.record.projectId), 'known_hosts'),
        hostKeyAlias: `sakura-${id}-${endpoint.record.projectId}`,
      });
    }
    return result;
  }
  start(id: string, signal?: AbortSignal) {
    const projectId = this.workspaces.projects.current(id);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    const operation = this.workspaces.projects.inScope(id, projectId, () =>
      this.machines.locked(id, () => this.prepare(id, abort)),
    );
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  private async prepare(id: string, signal: AbortSignal) {
    const distro = this.machines.get(id).distro;
    if (!distro || !['alpine', 'debian', 'ubuntu'].includes(distro))
      throw new AppError('项目 SSH 接入支持 Alpine、Debian 与 Ubuntu', 409);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    const project = await this.workspaces.resolvedConfig(id),
      projectId = project._workspace || 'default';
    const current = await this.status(id, project, signal);
    if (current.running) {
      if (!current.valid) throw new AppError(current.reason || '请先停止项目 SSH', 409);
      const folder = this.folder(id, projectId);
      await secureSshPaths([
        folder,
        ...['id_rsa', 'id_rsa.pub', 'known_hosts'].map((name) => join(folder, name)),
      ]);
      return this.endpoint(id, project, signal);
    }
    const p = projectSshPaths(projectId),
      namespace = projectNetworkNamespace(project),
      runId = randomUUID();
    const folder = this.folder(id, projectId);
    await regularDirectory(folder);
    await mkdir(folder, { recursive: true });
    await secureSshPaths([folder]);
    const readKey = (name: string) =>
      readFile(join(folder, name), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    let [privateKey, publicKey] = await Promise.all([readKey('id_rsa'), readKey('id_rsa.pub')]);
    if ((privateKey === null) !== (publicKey === null)) throw new AppError('项目 SSH 客户端密钥不完整', 409);
    if (privateKey === null) {
      const key = createSshKey();
      publicKey = key.publicText;
      privateKey = key.privateText;
      await writeFile(join(folder, 'id_rsa'), key.privateText, { mode: 0o600, flag: 'wx' });
      await writeFile(join(folder, 'id_rsa.pub'), key.publicText + '\n', { mode: 0o600, flag: 'wx' });
    }
    publicKey = publicKey!.trim();
    if (!/^ssh-rsa [A-Za-z0-9+/]+={0,2}(?: .*)?$/.test(publicKey))
      throw new AppError('项目 SSH 客户端密钥损坏', 409);
    const parsedKey = ssh2.utils.parseKey(privateKey!);
    if (
      parsedKey instanceof Error ||
      Array.isArray(parsedKey) ||
      parsedKey.getPublicSSH().toString('base64') !== publicKey.split(' ')[1]
    )
      throw new AppError('项目 SSH 公私钥不匹配', 409);
    await secureSshPaths([join(folder, 'id_rsa'), join(folder, 'id_rsa.pub')]);
    const prep = await guestTask(
      this.machines,
      id,
      `set -eu\n` +
        (distro === 'alpine'
          ? `if ! command -v python3 >/dev/null || ! test -x /usr/sbin/sshd || ! test -x /usr/lib/ssh/sftp-server || ! command -v nsenter >/dev/null; then apk add --no-cache --timeout 30 openssh-server openssh-sftp-server python3 iproute2 util-linux; fi\n` +
            `test -x /sbin/openrc-run\nrc-service cgroups start\ntest -f /sys/fs/cgroup/cgroup.controllers\n`
          : `if ! command -v python3 >/dev/null || ! test -x /usr/sbin/sshd; then export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 update; apt-get -o Acquire::Retries=2 install -y openssh-server python3; fi\n`) +
        (namespace
          ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n`
          : '') +
        ensureProjectNetworkScript(project, distro) +
        `umask 077\nfor path in /etc/sakura/ssh ${p.config}; do test ! -L "$path"; mkdir -p "$path"; done\n` +
        `for path in /var/lib/sakura /var/lib/sakura/ssh ${p.home}; do test ! -L "$path"; mkdir -p "$path"; done\n` +
        (distro === 'alpine'
          ? `for path in /run/sakura-project-ssh ${p.runtime}; do test ! -L "$path"; mkdir -p "$path"; chmod 700 "$path"; done\n`
          : '') +
        `mkdir -p /run/sshd ${quote(project.directory)}\nchmod 755 /run/sshd\nchmod 700 ${p.home}\n` +
        `test ! -L ${p.config}/hostkey\nif [ ! -f ${p.config}/hostkey ]; then ssh-keygen -q -t ed25519 -N '' -f ${p.config}/hostkey; fi\n` +
        `ssh-keygen -y -f ${p.config}/hostkey | awk '{print "SAKURA_SSH_HOST_KEY=" $1 " " $2}'`,
      signal,
      undefined,
      180_000,
    );
    if (prep.code !== 0) throw new AppError('无法准备项目 SSH 依赖或网络', 409);
    const hostPublicKey = z
      .string()
      .regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/)
      .parse(
        prep.stdout
          .trim()
          .split('\n')
          .find((line) => line.startsWith('SAKURA_SSH_HOST_KEY='))
          ?.slice('SAKURA_SSH_HOST_KEY='.length),
      );
    const portResult = await this.machines.exec(
      id,
      projectNetworkCommand(
        project,
        `exec python3 -I -S -c ${quote("import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")}`,
      ),
      10_000,
      signal,
    );
    if (portResult.code !== 0) throw new AppError('无法选择项目 SSH 端口', 409);
    const guestPort = z.coerce.number().int().min(1024).max(65535).parse(portResult.stdout.trim());
    const command =
      `#!/bin/sh\nset -eu\nset -- "\${SSH_ORIGINAL_COMMAND-}"\n` +
      (namespace ? projectNetworkCheckScript(namespace) + '\n' : '') +
      `${envPrefix(project.environment)}\nexport HOME=${quote(p.home)}\nexport VSCODE_AGENT_FOLDER="$HOME/.vscode-server"\n` +
      `cd ${quote(project.directory)}\nif [ -n "$1" ]; then exec /bin/sh -c "$1"; else exec /bin/sh -l; fi\n`;
    const config =
      `Port ${guestPort}\nListenAddress 127.0.0.1\nAddressFamily inet\n` +
      `HostKey ${p.config}/hostkey\nPidFile ${p.config}/sshd.pid\nAuthorizedKeysFile ${p.config}/authorized_keys\n` +
      `AllowUsers root\nPermitRootLogin prohibit-password\nAuthenticationMethods publickey\n` +
      `PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nUsePAM no\n` +
      `PermitUserEnvironment no\nPermitUserRC no\nAllowAgentForwarding no\nAllowTcpForwarding local\n` +
      `PermitOpen 127.0.0.1:* localhost:* [::1]:*\nAllowStreamLocalForwarding no\n` +
      `X11Forwarding no\nPermitTunnel no\nPrintMotd no\nForceCommand ${p.config}/command\n` +
      `Subsystem sftp ${distro === 'alpine' ? '/usr/lib/ssh/sftp-server' : '/usr/lib/openssh/sftp-server'} -d .\n`;
    const unit =
      `[Unit]\nDescription=Sakura project SSH ${projectId}\nAfter=network.target\n\n[Service]\n` +
      `Type=simple\nExecStart=/usr/sbin/sshd -D -e -f ${p.config}/sshd_config\n` +
      `Environment=SAKURA_PROJECT_SSH_ID=${runId}\nKillMode=control-group\nTimeoutStopSec=10s\nRestart=no\n` +
      (namespace ? `NetworkNamespacePath=/run/netns/${namespace}\n` : '') +
      `\n[Install]\n`;
    const files = {
      [p.config + '/command']: command,
      [p.config + '/sshd_config']: config,
      [p.config + '/authorized_keys']: publicKey + '\n',
      ...(distro === 'alpine'
        ? {
            [p.openrcPath]: openrcService(project),
            [p.config + '/launch.py']: openrcLauncher(project, runId),
          }
        : { [p.unitPath]: unit }),
    };
    const write = Object.entries(files)
      .map(
        ([path, text]) =>
          `test ! -L ${quote(path)}\nprintf '%s' ${quote(Buffer.from(text).toString('base64'))} | base64 -d > ${quote(path)}\n`,
      )
      .join('');
    const hashes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, digest(text)]));
    const hostKeyHash = await this.machines.exec(id, `sha256sum ${p.config}/hostkey`, 10_000, signal);
    if (hostKeyHash.code !== 0) throw new AppError('无法核对项目 SSH 主机密钥', 409);
    hashes[p.config + '/hostkey'] = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(hostKeyHash.stdout.split(' ')[0]);
    const record: Record = {
      version: 1,
      ...(distro === 'alpine' ? { manager: 'openrc' as const } : {}),
      projectId,
      runId,
      binding: projectSshBinding(project),
      guestPort,
      hostPublicKey,
      environment: environmentHash(project),
      files: hashes,
    };
    await writeStore(join(folder, 'runtime.json'), record);
    await writeFile(join(folder, 'known_hosts'), `sakura-${id}-${projectId} ${hostPublicKey}\n`, {
      mode: 0o600,
    });
    try {
      const started = await this.machines.exec(
        id,
        `set -eu\numask 077\n${write}` +
          `chmod 700 ${p.config}/command\nprintf '%s' ${quote(Buffer.from(JSON.stringify(record)).toString('base64'))} | base64 -d > ${p.config}/binding.json\n` +
          `/usr/sbin/sshd -t -f ${p.config}/sshd_config\n` +
          (distro === 'alpine'
            ? `chmod 700 ${p.openrcPath}\nrc-service ${p.openrcUnit} zap\nrc-service ${p.openrcUnit} start`
            : `systemctl daemon-reload\nsystemctl start ${p.unit}`),
        60_000,
        signal,
      );
      if (started.code !== 0) throw new AppError(started.stderr || '项目 SSH 启动失败', 409);
      let reason = '项目 SSH 未就绪';
      for (let attempt = 0; attempt < 40; attempt++) {
        signal.throwIfAborted();
        const status = await this.status(id, project, signal);
        if (status.valid) {
          return this.endpoint(id, project, signal);
        }
        reason = status.reason || reason;
        await delay(200, undefined, { signal });
      }
      throw new AppError(reason, 409);
    } catch (error) {
      await this.stopRuntime(id, project).catch(() => {});
      throw error;
    }
  }
  private async stopRuntime(id: string, project: Project) {
    const projectId = project._workspace || 'default',
      p = projectSshPaths(projectId);
    await this.bridges.stop(id, projectId);
    this.endpoints.delete(`${id}:${projectId}`);
    const stopped = await this.machines.exec(
      id,
      `set -eu\n` +
        (this.machines.get(id).distro === 'alpine'
          ? `python3 -I -S -c ${quote(openrcStopScript(p))}\n`
          : `systemctl stop ${p.unit}\n`) +
        projectSshBusyScript(projectId),
      30_000,
    );
    if (stopped.code !== 0 || stopped.stdout.includes('SAKURA_PROJECT_SSH_BUSY'))
      throw new AppError('项目 SSH 子进程尚未停止，绑定不可修改', 409);
  }
  async stop(id: string) {
    const project = await this.workspaces.config(id);
    return this.machines.locked(id, () => this.stopRuntime(id, project));
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled(this.pending);
    await this.bridges.close();
    this.endpoints.clear();
  }
}
