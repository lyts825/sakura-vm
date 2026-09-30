import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { projectIdSchema } from './project-catalog.ts';
import { quote } from './files.ts';
import { envPrefix } from './project-services.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkNamespace,
} from './project-network-isolation.ts';

export function privateDockerPaths(projectId: string) {
  const key = projectIdSchema.parse(projectId);
  const config = `/etc/sakura/docker/${key}`,
    runtime = `/run/sk-docker/${key}`,
    data = `/var/lib/sk-docker/${key}`,
    unit = `sakura-docker-${key}.service`;
  return {
    projectId: key,
    config,
    runtime,
    data,
    unit,
    socket: `${runtime}/d.sock`,
    containerdSocket: `${runtime}/c.sock`,
    unitPath: `/etc/systemd/system/${unit}`,
  };
}
export const privateDockerBinding = (project: Project) =>
  createHash('sha256')
    .update(JSON.stringify([project._workspace || 'default', project.directory, 'private']))
    .digest('hex');
export function privateComposeValidator(project: Project, labels: Record<string, string> = {}) {
  return (
    `def private_compose(value):\n` +
    `    if not isinstance(value,dict) or not isinstance(value.get('services'),dict) or not value['services']: raise SystemExit('Compose 没有可用服务')\n` +
    `    for service in value['services'].values():\n` +
    `        if service.get('network_mode')!='host' or service.get('ports') or service.get('networks'): raise SystemExit('私有 Compose 服务需要 network_mode: host，且不能发布端口或创建网络')\n` +
    `        if service.get('privileged') or any(c.upper().removeprefix('CAP_') in ('NET_ADMIN','SYS_ADMIN','ALL') for c in service.get('cap_add',[])): raise SystemExit('私有 Compose 不能修改项目网络或命名空间')\n` +
    `        service['restart']='no'\n` +
    `        if isinstance(service.get('build'),str): service['build']={'context':service['build']}\n` +
    `        if isinstance(service.get('build'),dict):\n` +
    `            if service['build'].get('network','host')!='host': raise SystemExit('私有构建需要项目 host 网络')\n` +
    `            service['build']['network']='host'\n` +
    `        labels=service.setdefault('labels',{})\n` +
    `        if not isinstance(labels,dict): raise SystemExit('私有 Compose labels 需要对象格式')\n` +
    `        labels.update(${JSON.stringify({ 'sakura.project': project._workspace || 'default', 'sakura.binding': privateDockerBinding(project), ...labels })})\n` +
    `        if os.environ.get('SAKURA_CONTAINER_ATTEMPT'): labels['sakura.attempt']=os.environ['SAKURA_CONTAINER_ATTEMPT']\n` +
    `    value.pop('networks',None)\n` +
    `    return value\n`
  );
}
const dockerArgs = (p: ReturnType<typeof privateDockerPaths>) => [
  '--config-file',
  `${p.config}/daemon.json`,
  '--containerd',
  p.containerdSocket,
  '--host',
  `unix://${p.socket}`,
  '--data-root',
  `${p.data}/docker`,
  '--exec-root',
  `${p.runtime}/exec`,
  '--pidfile',
  `${p.runtime}/d.pid`,
  '--bridge',
  'none',
  '--iptables=false',
  '--ip6tables=false',
  '--ip-forward=false',
  '--ip-masq=false',
  '--userland-proxy=false',
  '--exec-opt',
  'native.cgroupdriver=systemd',
  '--containerd-namespace',
  `sk-${p.projectId}`,
  '--containerd-plugins-namespace',
  `sk-${p.projectId}-plugins`,
];

// Explicit endpoints take precedence over project values and Docker contexts.
export function dockerClientEnvironment(projectId: string) {
  const p = privateDockerPaths(projectId);
  return (
    `unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_API_VERSION\n` +
    `export DOCKER_HOST=${quote(`unix://${p.socket}`)} DOCKER_CONFIG=${quote(`${p.config}/client`)} DOCKER_BUILDKIT=0\n` +
    `docker() { ${quote(p.config + '/docker-client')} "$@"; }\n`
  );
}
export function privateDockerCommand(project: Project, command: string, environment = true) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) throw new AppError('此项目没有私有网络', 409);
  const child =
    `set -eu\n${environment ? envPrefix(project.environment) : ''}\n` +
    dockerClientEnvironment(project._workspace || 'default') +
    `cd ${quote(project.directory)}\n${command}`;
  // ip netns exec remounts /sys and hides nested cgroup mounts on these guests.
  // nsenter changes only the network namespace, preserving container cgroups.
  return (
    `set -eu\n${projectNetworkCheckScript(namespace)}\n` +
    `exec nsenter --net=/run/netns/${namespace} -- env -i HOME=/root ` +
    `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C /bin/sh -c ${quote(child)}`
  );
}

export function privateDockerFiles(project: Project, runId: string) {
  z.uuid().parse(runId);
  const projectId = projectIdSchema.parse(project._workspace || 'default'),
    p = privateDockerPaths(projectId);
  const binding = privateDockerBinding(project);
  // Docker creates the overlay root with its process mask. Keep normal image
  // permissions for non-root entrypoints; preparation protects host files.
  const script =
    `#!/bin/sh\nset -eu\numask 022\n` +
    `export SAKURA_DOCKER_BINDING=${binding} SAKURA_DOCKER_RUN_ID=${runId}\n` +
    `mkdir -p ${p.runtime}\n` +
    `/usr/bin/containerd --config ${p.config}/containerd.toml --address ${p.containerdSocket} ` +
    `--root ${p.data}/containerd --state ${p.runtime}/c &\n` +
    `sakura_containerd=$!\n` +
    `for sakura_attempt in $(seq 1 60); do\n` +
    `test ! -S ${p.containerdSocket} || break\nkill -0 "$sakura_containerd"\nsleep 0.2\ndone\n` +
    `test -S ${p.containerdSocket}\nsakura_dockerd=/usr/sbin/dockerd\n` +
    `test -x "$sakura_dockerd" || sakura_dockerd=/usr/bin/dockerd\n` +
    `exec "$sakura_dockerd" ${dockerArgs(p).map(quote).join(' ')}\n`;
  const unit =
    `[Unit]\nDescription=Sakura private Docker ${projectId}\n` +
    `[Service]\nType=simple\nNetworkNamespacePath=/run/netns/${projectNetworkNamespace(project)}\n` +
    `ExecStart=/usr/bin/env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /bin/sh ${p.config}/run.sh\n` +
    `Restart=no\nKillMode=control-group\nTimeoutStopSec=30\nDelegate=yes\n`;
  const wrapper =
    `#!/usr/bin/python3 -I\nimport os,sys\na=sys.argv[1:]\n` +
    `if any(v in ('--host','--context','--config','--tls','--tlsverify') or v.startswith(('-H','--host=','--context=','--config=','--tls=','--tlsverify=')) for v in a): raise SystemExit('私有容器不能切换 Docker 连接')\n` +
    `if a and a[0]=='compose': os.execv(${JSON.stringify(p.config + '/compose-client')},[${JSON.stringify(p.config + '/compose-client')},*a[1:]])\n` +
    `if a and a[0]=='network' and len(a)>1 and a[1] in ('create','connect'): raise SystemExit('私有项目不创建容器网桥或连接其他网络')\n` +
    `if a and a[0] in ('run','create','build'):\n` +
    `    for i,v in enumerate(a):\n` +
    `        if v in ('--net','--network') and (i+1>=len(a) or a[i+1]!='host'): raise SystemExit('私有容器需要项目 host 网络')\n` +
    `        if v.startswith(('--net=','--network=')) and v.split('=',1)[1]!='host': raise SystemExit('私有容器需要项目 host 网络')\n` +
    `        if v=='--privileged' or v.startswith('--privileged=') and v!='--privileged=false': raise SystemExit('私有容器不能修改项目网络或命名空间')\n` +
    `        if v=='--cap-add' and (i+1>=len(a) or a[i+1].upper().removeprefix('CAP_') in ('NET_ADMIN','SYS_ADMIN','ALL')) or v.startswith('--cap-add=') and v.split('=',1)[1].upper().removeprefix('CAP_') in ('NET_ADMIN','SYS_ADMIN','ALL'): raise SystemExit('私有容器不能修改项目网络或命名空间')\n` +
    `        if v=='--restart' and (i+1>=len(a) or a[i+1]!='no') or v.startswith('--restart=') and v!='--restart=no': raise SystemExit('私有容器不在客户机开机时自行启动')\n` +
    `    if not any(v in ('--net','--network') or v.startswith(('--net=','--network=')) for v in a): a[1:1]=['--network','host']\n` +
    `    if a[0] in ('run','create') and not any(v=='--restart' or v.startswith('--restart=') for v in a): a[1:1]=['--restart','no']\n` +
    `os.environ.pop('DOCKER_CONTEXT',None)\nos.environ.pop('DOCKER_TLS_VERIFY',None)\n` +
    `os.environ.pop('DOCKER_CERT_PATH',None)\nos.environ.pop('DOCKER_API_VERSION',None)\nos.environ['DOCKER_BUILDKIT']='0'\n` +
    `os.execv('/usr/bin/docker',['/usr/bin/docker','--host',${JSON.stringify('unix://' + p.socket)},'--config',${JSON.stringify(p.config + '/client')},*a])\n`;
  const composeWrapper =
    `#!/usr/bin/python3 -I\nimport json,os,signal,subprocess,sys,tempfile,yaml\n` +
    `os.umask(0o077)\n` +
    `for key in ('DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_API_VERSION'): os.environ.pop(key,None)\n` +
    `os.environ.update(DOCKER_HOST=${JSON.stringify('unix://' + p.socket)},DOCKER_CONFIG=${JSON.stringify(p.config + '/client')},DOCKER_BUILDKIT='0')\n` +
    `docker=['/usr/bin/docker','--host',os.environ['DOCKER_HOST'],'--config',os.environ['DOCKER_CONFIG']]\n` +
    `base=docker+['compose'] if subprocess.run(docker+['compose','version'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0 else ['/usr/bin/docker-compose']\n` +
    `a=sys.argv[1:]; i=0; prefix=[]\n` +
    `while i<len(a) and a[i].startswith('-'):\n` +
    `    v=a[i]\n` +
    `    if v in ('--compatibility','--verbose','--no-ansi'): prefix.append(v); i+=1; continue\n` +
    `    options=('-f','--file','-p','--project-name','--project-directory','--env-file','--profile','--ansi','--log-level')\n` +
    `    if v in options and i+1<len(a): prefix.extend(a[i:i+2]); i+=2; continue\n` +
    `    if any(v.startswith(o+'=') for o in options): prefix.append(v); i+=1; continue\n` +
    `    raise SystemExit('私有 Compose 参数不受支持: '+v)\n` +
    `operation=a[i] if i<len(a) else 'help'\n` +
    `if operation not in ('config','up','create','run','build'): os.execv(base[0],base+prefix+a[i:])\n` +
    `render=subprocess.run(base+prefix+['config'],stdout=subprocess.PIPE,check=True,text=True)\n` +
    privateComposeValidator(project) +
    `value=private_compose(yaml.safe_load(render.stdout))\n` +
    `if operation=='config': print(json.dumps(value)); raise SystemExit(0)\n` +
    `normalized=[]; j=0\n` +
    `while j<len(prefix):\n` +
    `    if prefix[j] in ('-f','--file'): j+=2; continue\n` +
    `    if prefix[j].startswith(('-f=','--file=')): j+=1; continue\n` +
    `    normalized.append(prefix[j]); j+=1\n` +
    `path=None\n` +
    `def interrupted(signum,frame): raise SystemExit(128+signum)\n` +
    `for signum in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP): signal.signal(signum,interrupted)\n` +
    `try:\n` +
    `    with tempfile.NamedTemporaryFile(mode='w',prefix='.sakura-compose-',suffix='.json',delete=False) as file:\n` +
    `        path=file.name; json.dump(value,file)\n` +
    `    raise SystemExit(subprocess.call(base+normalized+['-f',path]+a[i:]))\n` +
    `finally:\n` +
    `    if path is not None: os.unlink(path)\n`;
  return {
    [`${p.config}/run.sh`]: script,
    [p.unitPath]: unit,
    [`${p.config}/docker-client`]: wrapper,
    [`${p.config}/compose-client`]: composeWrapper,
    [`${p.config}/daemon.json`]: '{}',
    [`${p.config}/containerd.toml`]: 'version = 2\ndisabled_plugins = ["io.containerd.grpc.v1.cri"]\n',
    [`${p.config}/client/config.json`]: '{"auths":{}}',
    [`${p.config}/binding.json`]: JSON.stringify({
      version: 1,
      projectId,
      directory: project.directory,
      binding,
      runId,
    }),
  };
}

const runtimeSchema = z
  .object({
    present: z.boolean(),
    running: z.boolean(),
    valid: z.boolean(),
    reason: z.string().nullable(),
    runId: z.uuid().nullable(),
    containers: z.number().int().min(0),
  })
  .strict();
export type PrivateDockerStatus = z.infer<typeof runtimeSchema>;

/** Inspection starts outside project environment and never falls back to the shared daemon. */
export function privateDockerStatusCommand(project: Project) {
  const projectId = project._workspace || 'default',
    p = privateDockerPaths(projectId);
  const templates = privateDockerFiles(project, '00000000-0000-4000-8000-000000000000');
  const data = {
    ...p,
    projectId,
    binding: privateDockerBinding(project),
    namespace: `sk-${projectId}`,
    directory: project.directory,
    argv: ['/usr/sbin/dockerd', ...dockerArgs(p)],
    templates,
  };
  const code = `import hashlib,json,os,re,subprocess
data=json.loads(${JSON.stringify(JSON.stringify(data))})
env={'HOME':'/root','PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'}
def call(*args):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env,timeout=10)
def daemon(*args): return call('/usr/bin/docker','--host','unix://'+data['socket'],*args)
def argv(pid): return open('/proc/'+str(pid)+'/cmdline','rb').read().rstrip(bytes([0])).decode().split(chr(0))
def same(a,b): return os.path.samestat(os.stat(a),os.stat(b))
records=data['data']+'/docker/containers'
result={'present':os.path.isfile(data['config']+'/binding.json'),'running':False,'valid':False,'reason':None,'runId':None,'containers':len(os.listdir(records)) if os.path.isdir(records) else 0}
try:
    pid=call('systemctl','show',data['unit'],'-p','MainPID','--value').stdout.strip()
    owned=[]
    for entry in os.listdir('/proc'):
        if not entry.isdecimal(): continue
        try:
            args=argv(entry)
            if args and os.path.basename(args[0])=='dockerd' and data['config']+'/daemon.json' in args: owned.append(int(entry))
        except (OSError,UnicodeError): pass
    result['running']=bool(owned) or (pid.isdecimal() and int(pid)>0)
    if not result['running']:
        print(json.dumps(result)); raise SystemExit(0)
    if not pid.isdecimal() or int(pid)<=1 or owned!=[int(pid)]: raise ValueError('私有 Docker 的服务与实际守护进程不一致，请停止环境后重试')
    pid=int(pid)
    record=json.load(open(data['config']+'/binding.json'))
    run=record.get('runId','')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',run): raise ValueError('私有 Docker 没有有效启动标识')
    if record.get('version')!=1 or record.get('binding')!=data['binding'] or record.get('projectId')!=data['projectId'] or record.get('directory')!=data['directory']:
        raise ValueError('私有 Docker 的项目目录或网络绑定已变化，请停止环境后重建')
    for path,expected in data['templates'].items():
        if path.endswith('/binding.json'): continue
        if os.path.islink(path) or open(path).read()!=expected.replace('00000000-0000-4000-8000-000000000000',run):
            raise ValueError('私有 Docker 的运行配置已变化，请停止环境后重建')
    dockerd='/usr/sbin/dockerd' if os.access('/usr/sbin/dockerd',os.X_OK) else '/usr/bin/dockerd'
    if argv(pid)!=[dockerd,*data['argv'][1:]] or not same('/proc/'+str(pid)+'/exe',dockerd):
        raise ValueError('私有 Docker 的程序或参数已变化')
    network='/run/netns/'+data['namespace']
    if not same('/proc/'+str(pid)+'/ns/net',network): raise ValueError('Docker 未进入项目网络空间')
    for key in ('SAKURA_DOCKER_BINDING='+data['binding'],'SAKURA_DOCKER_RUN_ID='+run):
        if key.encode() not in open('/proc/'+str(pid)+'/environ','rb').read().split(bytes([0])): raise ValueError('Docker 进程启动绑定无效')
    children=[]
    for entry in os.listdir('/proc'):
        if not entry.isdecimal(): continue
        try:
            args=argv(entry)
            if args and os.path.basename(args[0])=='containerd' and data['containerdSocket'] in args: children.append(int(entry))
        except (OSError,UnicodeError): pass
    if len(children)!=1 or not same('/proc/'+str(children[0])+'/ns/net',network): raise ValueError('containerd 未进入项目网络空间')
    for family in ('-4','-6'):
        routes=call('ip','-n',data['namespace'],'-o',family,'route','show')
        if routes.returncode or routes.stdout.strip(): raise ValueError('项目网络已有额外路由，拒绝使用容器')
    links=call('ip','-n',data['namespace'],'-o','link','show')
    if links.returncode or len(links.stdout.splitlines())!=1: raise ValueError('项目网络已有额外接口，拒绝使用容器')
    listing=daemon('ps','-aq','--no-trunc')
    if listing.returncode: raise ValueError('无法连接此项目的 Docker，拒绝改用共享网络')
    ids=listing.stdout.split()
    result['containers']=len(ids)
    if ids:
        details=daemon('inspect',*ids)
        if details.returncode: raise ValueError('无法核对项目容器')
        for item in json.loads(details.stdout):
            if item['HostConfig']['NetworkMode']!='host': raise ValueError('项目容器未使用此项目回环网络，请移除后重建')
            if item['HostConfig']['RestartPolicy']['Name'] not in ('','no') or item['HostConfig']['Privileged'] or any(c.upper().removeprefix('CAP_') in ('NET_ADMIN','SYS_ADMIN','ALL') for c in (item['HostConfig'].get('CapAdd') or [])): raise ValueError('项目容器配置超出私有运行条件，请移除后重建')
            if item['State']['Running']:
                target=item['State']['Pid']
                if target<=1 or not same('/proc/'+str(target)+'/ns/net',network): raise ValueError('容器进程未进入项目网络空间')
    result.update(valid=True,runId=run)
except (OSError,ValueError,KeyError,subprocess.SubprocessError):
    import sys
    error=sys.exc_info()[1]
    result['reason']=str(error) if isinstance(error,ValueError) else '无法核对私有 Docker，请检查客户机依赖或停止环境后重试'
print(json.dumps(result,ensure_ascii=False))`;
  return `python3 -I -S -c ${quote(code)}`;
}

export async function privateDockerStatus(
  machines: Machines,
  id: string,
  project: Project,
  signal?: AbortSignal,
) {
  if (machines.state(id) !== 'running')
    return {
      present: false,
      running: false,
      valid: false,
      reason: null,
      runId: null,
      containers: 0,
    } satisfies PrivateDockerStatus;
  const p = privateDockerPaths(project._workspace || 'default');
  const result = await machines.exec(
    id,
    `if command -v python3 >/dev/null; then ${privateDockerStatusCommand(project)}; ` +
      `elif [ -e ${quote(p.config + '/binding.json')} ] || [ -d ${quote(p.data)} ]; then exit 127; ` +
      `else printf '%s' ${quote(JSON.stringify({ present: false, running: false, valid: false, reason: null, runId: null, containers: 0 }))}; fi`,
    30_000,
    signal,
  );
  if (result.code !== 0) throw new AppError('无法核对私有 Docker，请先安装 Python 3', 409);
  return runtimeSchema.parse(JSON.parse(result.stdout));
}

/** Callers hold the VM lock, including cleanup, through this operation. */
export async function preparePrivateDocker(
  machines: Machines,
  id: string,
  project: Project,
  signal: AbortSignal,
) {
  const existing = await privateDockerStatus(machines, id, project, signal);
  if (existing.running) {
    if (!existing.valid) throw new AppError(existing.reason || '私有 Docker 绑定无效', 409);
    return existing;
  }
  const projectId = project._workspace || 'default',
    p = privateDockerPaths(projectId),
    runId = randomUUID();
  const namespace = projectNetworkNamespace(project);
  if (!namespace) throw new AppError('此项目没有私有网络', 409);
  const files = privateDockerFiles(project, runId);
  const writes = Object.entries(files)
    .map(
      ([path, content]) =>
        `test ! -L ${quote(path)}\nprintf '%s' ${quote(Buffer.from(content).toString('base64'))} | base64 -d > ${quote(path)}\n`,
    )
    .join('');
  try {
    const setup = await machines.exec(
      id,
      `set -eu\n` +
        `for sakura_tool in docker dockerd containerd python3 nsenter systemctl; do command -v "$sakura_tool" >/dev/null; done\n` +
        `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n` +
        ensureProjectNetworkScript(project, machines.get(id).distro || 'debian') +
        `umask 077\nfor sakura_path in /etc/sakura/docker /var/lib/sk-docker /run/sk-docker ${p.config} ${p.data} ${p.runtime}; do ` +
        `test ! -L "$sakura_path"; mkdir -p "$sakura_path"; done\ntest ! -L ${p.config}/client\nmkdir -p ${p.config}/client ${quote(project.directory)}\n` +
        `if test -f ${p.config}/binding.json; then python3 -I -S -c ${quote(`import json,os\np=${JSON.stringify(p.data + '/docker/containers')}\nr=json.load(open(${JSON.stringify(p.config + '/binding.json')}))\nif r.get('binding')!=${JSON.stringify(privateDockerBinding(project))} and os.path.isdir(p) and os.listdir(p): raise SystemExit('旧绑定仍有容器，请先恢复旧项目设置并移除容器')`)}; fi\n` +
        writes +
        `chmod 700 ${p.config}/docker-client ${p.config}/compose-client\nsystemctl daemon-reload\nsystemctl start ${p.unit}`,
      90_000,
      signal,
    );
    if (setup.code !== 0) {
      throw new AppError(setup.stderr || '无法准备私有 Docker', 409);
    }
    let reason = '私有 Docker 未就绪，请检查服务日志';
    for (let attempt = 0; attempt < 60; attempt++) {
      signal.throwIfAborted();
      const status = await privateDockerStatus(machines, id, project, signal);
      if (status.valid && status.runId === runId) return status;
      if (status.reason) reason = status.reason;
      await delay(200, undefined, { signal });
    }
    throw new AppError(reason, 409);
  } catch (error) {
    await stopPrivateDocker(machines, id, project, runId);
    throw error;
  }
}
export async function stopPrivateDocker(
  machines: Machines,
  id: string,
  project: Project,
  expectedRunId?: string,
) {
  const p = privateDockerPaths(project._workspace || 'default');
  if (!expectedRunId && !(await privateDockerStatus(machines, id, project)).running) return;
  const predicate = expectedRunId
    ? `if ! python3 -I -S -c ${quote(`import json\nr=json.load(open(${JSON.stringify(p.config + '/binding.json')}))\nraise SystemExit(0 if r.get('runId')==${JSON.stringify(expectedRunId)} else 3)`)} 2>/dev/null; then exit 0; fi\n`
    : '';
  const result = await machines.exec(
    id,
    `set -eu\n${predicate}` +
      `if command -v docker >/dev/null && docker --host unix://${p.socket} ps -q >/dev/null 2>&1; then\n` +
      `ids=$(docker --host unix://${p.socket} ps -q)\nif [ -n "$ids" ]; then docker --host unix://${p.socket} stop --time 5 $ids; fi\nfi\n` +
      `systemctl stop ${p.unit}\nprintf '\\nSAKURA_DOCKER_STOPPED\\n'`,
    60_000,
  );
  if (result.code !== 0) throw new AppError('私有 Docker 环境未能停止，请检查客户机服务', 409);
  const status = await privateDockerStatus(machines, id, project);
  if (expectedRunId && !result.stdout.includes('SAKURA_DOCKER_STOPPED')) return;
  if (status.running) throw new AppError('私有 Docker 的遗留进程仍在运行，绑定不可修改', 409);
}
