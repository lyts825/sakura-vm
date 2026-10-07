/**
 * 模块职责：生成客户机网格边车的配置和运行命令，核对项目策略及原会话绑定后才能停止。
 * Module purpose: Builds guest sidecar configuration/run commands; stopping verifies project policy and original session binding.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Project } from './project-config.ts';
import { quote } from './shell.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { envPrefix } from './project-services.ts';

type Ports = { name: string; listenPort: number; upstreamPort: number };
/**
 * 入口 / Entry: meshSession.
 * 功能：从当前输入或状态计算 ``sakura-mesh-${projectIdSchema.parse(projectId)}``，供调用方后续验证或使用。
 * Purpose: Computes ``sakura-mesh-${projectIdSchema.parse(projectId)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: projectId: string
 * 输出 / Returns: ``sakura-mesh-${projectIdSchema.parse(projectId)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const meshSession = (projectId: string) => `sakura-mesh-${projectIdSchema.parse(projectId)}`;
/**
 * 入口 / Entry: meshConfigPath.
 * 功能：从当前输入或状态计算 ``/etc/sakura/mesh/${projectIdSchema.parse(projectId)}.json``，供调用方后续验证或使用。
 * Purpose: Computes ``/etc/sakura/mesh/${projectIdSchema.parse(projectId)}.json`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: projectId: string
 * 输出 / Returns: ``/etc/sakura/mesh/${projectIdSchema.parse(projectId)}.json``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const meshConfigPath = (projectId: string) =>
  `/etc/sakura/mesh/${projectIdSchema.parse(projectId)}.json`;
/**
 * 入口 / Entry: meshLogPath.
 * 功能：从当前输入或状态计算 ``/var/log/sakura-mesh-${projectIdSchema.parse(projectId)}.log``，供调用方后续验证或使用。
 * Purpose: Computes ``/var/log/sakura-mesh-${projectIdSchema.parse(projectId)}.log`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: projectId: string
 * 输出 / Returns: ``/var/log/sakura-mesh-${projectIdSchema.parse(projectId)}.log``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const meshLogPath = (projectId: string) =>
  `/var/log/sakura-mesh-${projectIdSchema.parse(projectId)}.log`;
/**
 * 入口 / Entry: meshBinding.
 * 功能：在生成客户机网格边车的配置和运行命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256') .update( JSON.stringify([ project._workspace || 'default', project.directory, project.networkIsolation |…` 供上层消费（`service-mesh-guest.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-mesh-guest.ts`; this entry produces `createHash('sha256') .update( JSON.stringify([ project._workspace || 'default', project.directory, project.networkIsolation |…` for its caller. Module context: Builds guest sidecar configuration/run commands; stopping verifies project policy and original session binding.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; policy: Ports
 * 输出 / Returns: `createHash('sha256') .update( JSON.stringify([ project._workspace || 'default', project.directory, project.networkIsolation |…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const meshBinding = (project: Project, policy: Ports) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        project._workspace || 'default',
        project.directory,
        project.networkIsolation || 'host',
        policy.name,
        policy.listenPort,
        policy.upstreamPort,
      ]),
    )
    .digest('hex');
/**
 * 入口 / Entry: argumentsFor.
 * 功能：从当前输入或状态计算 `[ envoy, '-c', meshConfigPath(projectId), '--disable-hot-restart', '--concurrency', '1', '--log-level', 'warning', ]`，供调用方后续验证或使用。
 * Purpose: Computes `[ envoy, '-c', meshConfigPath(projectId), '--disable-hot-restart', '--concurrency', '1', '--log-level', 'warning', ]` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: envoy: string; projectId: string
 * 输出 / Returns: `[ envoy, '-c', meshConfigPath(projectId), '--disable-hot-restart', '--concurrency', '1', '--log-level', 'warning', ]`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const argumentsFor = (envoy: string, projectId: string) => [
  envoy,
  '-c',
  meshConfigPath(projectId),
  '--disable-hot-restart',
  '--concurrency',
  '1',
  '--log-level',
  'warning',
];

/** Enter the namespace before exporting project values or starting the executable. */
/**
 * 入口 / Entry: meshProjectCommand.
 * 功能：在生成客户机网格边车的配置和运行命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( `set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + (replaceShell ? 'exec ' : '') + (namespace ?…` 供上层消费（`service-mesh-guest.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-mesh-guest.ts`; this entry produces `( `set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + (replaceShell ? 'exec ' : '') + (namespace ?…` for its caller. Module context: Builds guest sidecar configuration/run commands; stopping verifies project policy and original session binding.
 * 处理：通过 `projectNetworkNamespace`, `envPrefix`, `quote`, `projectNetworkCheckScript` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `envPrefix`, `quote`, `projectNetworkCheckScript`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; command: string; replaceShell: default=true
 * 输出 / Returns: `( `set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + (replaceShell ? 'exec ' : '') + (namespace ?…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function meshProjectCommand(project: Project, command: string, replaceShell = true) {
  const namespace = projectNetworkNamespace(project);
  const child = `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n${command}`;
  return (
    `set -eu\n` +
    (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') +
    (replaceShell ? 'exec ' : '') +
    (namespace ? `ip netns exec ${namespace} ` : '') +
    `env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C ` +
    `/bin/sh -c ${quote(child)}`
  );
}

/**
 * 入口 / Entry: meshStartScript.
 * 功能：在生成客户机网格边车的配置和运行命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( `set -eu\ntmux new-session -d -s ${meshSession(projectId)} -c ${quote(project.directory)} ` + `-e SAKURA_MESH_BINDING=${mes…` 供上层消费（`service-mesh-guest.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-mesh-guest.ts`; this entry produces `( `set -eu\ntmux new-session -d -s ${meshSession(projectId)} -c ${quote(project.directory)} ` + `-e SAKURA_MESH_BINDING=${mes…` for its caller. Module context: Builds guest sidecar configuration/run commands; stopping verifies project policy and original session binding.
 * 处理：通过 `z.uuid().parse`, `z.uuid`, `meshProjectCommand`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `meshProjectCommand`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; policy: Ports; envoy: string; runId: string
 * 输出 / Returns: `( `set -eu\ntmux new-session -d -s ${meshSession(projectId)} -c ${quote(project.directory)} ` + `-e SAKURA_MESH_BINDING=${mes…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function meshStartScript(project: Project, policy: Ports, envoy: string, runId: string) {
  z.uuid().parse(runId);
  const projectId = project._workspace || 'default';
  const command = meshProjectCommand(
    project,
    `export SAKURA_MESH_RUN_ID=${quote(runId)}\nexec ${argumentsFor(envoy, projectId).map(quote).join(' ')} ` +
      `> ${quote(meshLogPath(projectId))} 2>&1`,
  );
  // Tag the session at creation, so an interrupted launch can remove only its
  // own attempt. A pre-existing tmux server never determines the pane's network.
  return (
    `set -eu\ntmux new-session -d -s ${meshSession(projectId)} -c ${quote(project.directory)} ` +
    `-e SAKURA_MESH_BINDING=${meshBinding(project, policy)} -e SAKURA_MESH_RUN_ID=${runId} ${quote(command)}`
  );
}

// Process discovery also finds an Envoy whose tmux session has disappeared.
// Read-only inspection and pidfd cleanup share the exact ownership predicate;
// other projects use different fixed configuration paths.
const runtimePython = `import hashlib,json,os,re,select,signal,subprocess,time
def tmux(*args):
    return subprocess.run([data['tmux'],*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
def session():
    if not data['tmux']: return None
    result=tmux('list-sessions','-F','#{session_name} #{session_id}')
    for line in result.stdout.splitlines():
        fields=line.split()
        if len(fields)==2 and fields[0]==data['session'] and re.fullmatch(r'\\$[0-9]+',fields[1]): return fields[1]
    return None
def variable(target,name):
    result=tmux('show-environment','-t',target,name)
    prefix=name+'='
    return result.stdout.strip()[len(prefix):] if result.returncode==0 and result.stdout.startswith(prefix) else None
def frame(pid):
    root='/proc/'+str(pid)
    try:
        argv=open(root+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')
        argv=[value.decode('utf-8') for value in argv]
        if not argv or os.path.basename(argv[0])!='envoy': return None
        if not any(argv[i] in ('-c','--config-path') and argv[i+1]==data['path'] for i in range(len(argv)-1)): return None
        values=open(root+'/environ','rb').read().split(b'\\0')
        run=next((v[len(b'SAKURA_MESH_RUN_ID='):].decode('ascii') for v in values if v.startswith(b'SAKURA_MESH_RUN_ID=')),None)
        birth=open(root+'/stat').read().rsplit(')',1)[1].split()[19]
        return {'pid':pid,'argv':argv,'run':run,'birth':birth}
    except (OSError,UnicodeError,ValueError,IndexError): return None
def processes():
    result=[]
    for entry in os.listdir('/proc'):
        if entry.isdecimal() and int(entry)>1:
            value=frame(int(entry))
            if value: result.append(value)
    return result
def samefile(a,b):
    return os.path.samestat(os.stat(a),os.stat(b))
def inspect():
    target=session()
    owned=processes()
    live=target is not None or bool(owned)
    result={'sidecarRunning':live,'bindingValid':None if not live else False,
        'bindingError':None,'runId':None,'processes':[p['pid'] for p in owned]}
    if not live: return result
    try:
        if target is None: raise ValueError('边车会话已丢失，请先停止此项目的遗留进程')
        if not data['binding']: raise ValueError('运行中的边车没有当前项目策略，请先停止')
        if variable(target,'SAKURA_MESH_BINDING')!=data['binding']:
            raise ValueError('边车的项目目录、网络或策略绑定已变化，请先停止')
        run=variable(target,'SAKURA_MESH_RUN_ID')
        if not run or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',run):
            raise ValueError('旧版边车没有启动标识，请先停止再启动')
        panes=tmux('list-panes','-s','-t',target,'-F','#{pane_pid}')
        pids=[int(value) for value in panes.stdout.splitlines()]
        if panes.returncode or len(pids)!=1 or len(owned)!=1 or owned[0]['pid']!=pids[0]:
            raise ValueError('边车窗格与实际代理进程不一致，请先停止')
        process=owned[0]
        if process['run']!=run or process['argv']!=data['argv']:
            raise ValueError('边车的实际启动参数或标识不一致，请先停止')
        root='/proc/'+str(pids[0])
        if not samefile(root+'/exe',data['envoy']): raise ValueError('边车执行程序已变化，请先停止')
        if not samefile(root+'/cwd',data['directory']): raise ValueError('边车未运行在项目目录中，请先停止')
        namespace=data['namespace']
        expected='/var/run/netns/'+namespace if namespace else '/proc/self/ns/net'
        if not samefile(root+'/ns/net',expected): raise ValueError('边车未处于项目网络空间，请先停止')
        if namespace:
            def ip(*args):
                return subprocess.run(['ip','-n',namespace,*args],check=True,stdout=subprocess.PIPE,text=True).stdout.strip()
            if len(ip('-o','link','show').splitlines())!=1 or ip('-o','-4','route','show') or ip('-o','-6','route','show'):
                raise ValueError('项目命名空间已有额外接口或路由，拒绝使用边车')
        if os.path.islink(data['path']) or hashlib.sha256(open(data['path'],'rb').read()).hexdigest()!=data['configSha256']:
            raise ValueError('边车配置文件已变化，请先停止再启动')
        sockets=set()
        for entry in os.listdir(root+'/fd'):
            try: sockets.add(os.readlink(root+'/fd/'+entry))
            except OSError: pass
        address='0100007F:'+format(data['listenPort'],'04X')
        rows=[line.split() for line in open(root+'/net/tcp').read().splitlines()[1:]]
        if not any(len(row)>9 and row[1]==address and row[3]=='0A' and 'socket:['+row[9]+']' in sockets for row in rows):
            raise ValueError('边车的项目回环监听尚未就绪')
        result.update(bindingValid=True,runId=run)
    except (OSError,ValueError,subprocess.SubprocessError):
        import sys
        error=sys.exc_info()[1]
        result['bindingError']=str(error) if isinstance(error,ValueError) else '无法核对边车的实际进程与项目绑定，请先停止'
    return result
def stop():
    expected=data.get('expectedRunId')
    target=session()
    if target and (not expected or variable(target,'SAKURA_MESH_RUN_ID')==expected):
        result=tmux('kill-session','-t',target)
        if result.returncode: raise RuntimeError('停止项目边车会话失败')
    deadline=time.monotonic()+8
    while True:
        owned=[p for p in processes() if not expected or p['run']==expected]
        if not owned: return
        handles=[]
        try:
            for process in owned:
                try:
                    fd=os.pidfd_open(process['pid'])
                except ProcessLookupError: continue
                current=frame(process['pid'])
                if not current or current!=process:
                    os.close(fd)
                    raise RuntimeError('边车进程身份已变化，请重试停止')
                handles.append(fd)
            for fd in handles:
                try: signal.pidfd_send_signal(fd,signal.SIGTERM)
                except ProcessLookupError: pass
            if handles:
                poll=select.poll()
                for fd in handles: poll.register(fd,select.POLLIN)
                remaining=set(handles)
                wait=time.monotonic()+1
                while remaining and time.monotonic()<wait:
                    remaining.difference_update(fd for fd,_ in poll.poll(100))
                for fd in remaining:
                    try: signal.pidfd_send_signal(fd,signal.SIGKILL)
                    except ProcessLookupError: pass
        finally:
            for fd in handles: os.close(fd)
        if time.monotonic()>=deadline: raise RuntimeError('边车进程未能退出，项目绑定仍不可修改')
        time.sleep(0.1)
`;

/**
 * 入口 / Entry: meshRuntimeCommand.
 * 功能：在生成客户机网格边车的配置和运行命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${quote(tools.python)} -I -S -c ${quote( `import json\ndata=json.loads(${JSON.stringify(JSON.stringify(data))})\n` + runtime…` 供上层消费（`service-mesh-guest.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-mesh-guest.ts`; this entry produces ``${quote(tools.python)} -I -S -c ${quote( `import json\ndata=json.loads(${JSON.stringify(JSON.stringify(data))})\n` + runtime…` for its caller. Module context: Builds guest sidecar configuration/run commands; stopping verifies project policy and original session binding.
 * 处理：通过 `meshSession`, `meshConfigPath`, `projectNetworkNamespace`, `meshBinding` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `meshSession`, `meshConfigPath`, `projectNetworkNamespace`, `meshBinding`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; policy: Ports | null; config: string | null; tools: { envoy: string; tmux: string; python: string }; mode: 'inspect' | 'stop' default='inspect'; expectedRunId: string optional
 * 输出 / Returns: ``${quote(tools.python)} -I -S -c ${quote( `import json\ndata=json.loads(${JSON.stringify(JSON.stringify(data))})\n` + runtime…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function meshRuntimeCommand(
  project: Project,
  policy: Ports | null,
  config: string | null,
  tools: { envoy: string; tmux: string; python: string },
  mode: 'inspect' | 'stop' = 'inspect',
  expectedRunId?: string,
) {
  const projectId = project._workspace || 'default';
  const data = {
    session: meshSession(projectId),
    path: meshConfigPath(projectId),
    directory: project.directory,
    namespace: projectNetworkNamespace(project),
    binding: policy ? meshBinding(project, policy) : null,
    configSha256: config ? createHash('sha256').update(config).digest('hex') : null,
    listenPort: policy?.listenPort || null,
    argv: argumentsFor(tools.envoy, projectId),
    envoy: tools.envoy,
    tmux: tools.tmux,
    ...(expectedRunId ? { expectedRunId } : {}),
  };
  return `${quote(tools.python)} -I -S -c ${quote(
    `import json\ndata=json.loads(${JSON.stringify(JSON.stringify(data))})\n` +
      runtimePython +
      '\n' +
      (mode === 'stop' ? 'stop()' : 'print(json.dumps(inspect(),ensure_ascii=False))'),
  )}`;
}

/**
 * 入口 / Entry: meshStopCommand.
 * 功能：把本层请求转交 `meshRuntimeCommand`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `meshRuntimeCommand` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; tools: { envoy: string; tmux: string; python: string }; runId: string optional
 * 输出 / Returns: `meshRuntimeCommand(project, null, null, tools, 'stop', runId)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function meshStopCommand(
  project: Project,
  tools: { envoy: string; tmux: string; python: string },
  runId?: string,
) {
  // An ordinary stop cleans current and legacy launches of this fixed project
  // config. Startup rollback supplies an exact attempt ID.
  return meshRuntimeCommand(project, null, null, tools, 'stop', runId);
}
