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
  };
}
export const projectSshBinding = (project: Project) =>
  digest(
    JSON.stringify([project._workspace || 'default', project.directory, project.networkIsolation || 'host']),
  );

function servicePresent(p: ReturnType<typeof projectSshPaths>) {
  return `[ -d ${p.config} ] || [ -e ${p.unitPath} ] || { command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ${p.unit}; }`;
}

/** Includes detached children that retain the service cgroup after their SSH channel closes. */
export function projectSshBusyScript(projectId: string) {
  const p = projectSshPaths(projectId);
  return `if ${servicePresent(p)}; then python3 -I -S -c ${quote(
    `import glob,os\nunit=${JSON.stringify('/' + p.unit)}\n` +
      `for path in glob.glob('/proc/[0-9]*/cgroup'):\n` +
      ` try:\n  groups=open(path).read().splitlines()\n` +
      `  if any(g.split(':',2)[-1].endswith(unit) or unit+'/' in g.split(':',2)[-1] for g in groups): print('SAKURA_PROJECT_SSH_BUSY'); break\n` +
      ` except (OSError,ProcessLookupError): pass`,
  )}; fi`;
}

const recordSchema = z
  .object({
    version: z.literal(1),
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
      p.unitPath,
    ];
    if (
      Object.keys(record.files).length !== required.length ||
      required.some((path) => !(path in record.files))
    )
      context.addIssue({ code: 'custom', message: '项目 SSH 文件绑定不完整' });
  });
type Record = z.infer<typeof recordSchema>;
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

function statusCommand(project: Project, record: Record | null) {
  const p = projectSshPaths(project._workspace || 'default'),
    namespace = projectNetworkNamespace(project);
  const script =
    `import glob,hashlib,json,os,subprocess\n` +
    `unit=${JSON.stringify(p.unit)}; config=${JSON.stringify(p.config)}\n` +
    `expected=${record ? JSON.stringify(record) : 'None'}\n` +
    `out={'present':os.path.exists(config+'/binding.json'),'running':False,'valid':False,'processes':0,'reason':None}\n` +
    `def show(field):\n return subprocess.check_output(['systemctl','show','--value','--property',field,unit],text=True).strip()\n` +
    `try:\n` +
    ` pid=int(show('MainPID') or '0')\n` +
    ` owned=[]\n` +
    ` for path in glob.glob('/proc/[0-9]*/cgroup'):\n` +
    `  try:\n` +
    `   if any(g.split(':',2)[-1].endswith('/'+unit) or '/'+unit+'/' in g.split(':',2)[-1] for g in open(path).read().splitlines()): owned.append(int(path.split('/')[2]))\n` +
    `  except (OSError,ProcessLookupError): pass\n` +
    ` out['processes']=len(owned); out['running']=bool(owned or pid)\n` +
    ` if not out['running']: raise ValueError('项目 SSH 尚未启动')\n` +
    ` if expected is None or expected['binding']!=${JSON.stringify(projectSshBinding(project))}: raise ValueError('项目 SSH 绑定已变化，请停止并重建')\n` +
    ` if json.load(open(config+'/binding.json'))!=expected: raise ValueError('项目 SSH 启动记录已变化')\n` +
    ` for path,wanted in expected['files'].items():\n` +
    `  if os.path.islink(path) or hashlib.sha256(open(path,'rb').read()).hexdigest()!=wanted: raise ValueError('项目 SSH 配置或密钥已变化')\n` +
    ` if pid not in owned or os.path.realpath('/proc/'+str(pid)+'/exe')!='/usr/sbin/sshd': raise ValueError('项目 SSH 服务进程不符')\n` +
    ` args=open('/proc/'+str(pid)+'/cmdline','rb').read().decode().replace(chr(0),' ')\n` +
    ` if config+'/sshd_config' not in args: raise ValueError('项目 SSH 进程参数不符')\n` +
    // OpenSSH clears its daemon environment during initialization. Check the
    // owning systemd unit's configured start identity instead.
    ` if 'SAKURA_PROJECT_SSH_ID='+expected['runId'] not in show('Environment').split(): raise ValueError('项目 SSH 启动标识不符')\n` +
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
      return value === null ? null : recordSchema.parse(value);
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
    const result = await this.machines.exec(id, statusCommand(project, record), 30_000, signal);
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
    if (!['debian', 'ubuntu'].includes(this.machines.get(id).distro || 'alpine'))
      throw new AppError('项目 SSH 接入支持 Debian 与 Ubuntu', 409);
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
        `if ! command -v python3 >/dev/null || ! test -x /usr/sbin/sshd; then export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 update; apt-get -o Acquire::Retries=2 install -y openssh-server python3; fi\n` +
        (namespace
          ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n`
          : '') +
        ensureProjectNetworkScript(project, this.machines.get(id).distro || 'debian') +
        `umask 077\nfor path in /etc/sakura/ssh ${p.config}; do test ! -L "$path"; mkdir -p "$path"; done\n` +
        `for path in /var/lib/sakura /var/lib/sakura/ssh ${p.home}; do test ! -L "$path"; mkdir -p "$path"; done\n` +
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
      `Subsystem sftp /usr/lib/openssh/sftp-server -d .\n`;
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
      [p.unitPath]: unit,
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
          `/usr/sbin/sshd -t -f ${p.config}/sshd_config\nsystemctl daemon-reload\nsystemctl start ${p.unit}`,
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
      `set -eu\nsystemctl stop ${p.unit}\n${projectSshBusyScript(projectId)}`,
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
