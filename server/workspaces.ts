import { Metrics } from './metrics.ts';
export { metricsScript, parseMetrics } from './metrics.ts';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';
import { Jobs } from './jobs.ts';
import { quote } from './files.ts';
import {
  serviceSchema,
  environmentSchema,
  serviceOrder,
  runServices,
  serviceLog,
  type ProjectService,
} from './project-services.ts';
import { guestTask } from './guest-task.ts';
import { secretRefsSchema, privateLog, redactValues, type Secrets } from './secrets.ts';
import type { NetworkProfiles } from './network-profiles.ts';
import { ProjectCatalog } from './project-catalog.ts';
import { runtimesSchema, runtimeEnvironment } from './runtime-versions.ts';
import { guardProjectQuotaDirectory, projectQuota, readProjectQuotaRecord } from './project-quota.ts';
import { ensureProjectNetworkScript,
  removeProjectNetwork } from './project-network-isolation.ts';
import { terminalSessionPrefix } from '../shared/terminal-scope.ts';
import { privateDockerPaths, privateDockerStatus } from './private-docker.ts';
import { projectSshBusyScript } from './project-ssh.ts';
import { resolveDependencyAuthentication } from './dependency-downloads.ts';
import { ProjectMainScope, ProjectServiceScopes } from './project-service-scope.ts';
import { legacyMainStatus, mainLog, mainSession, runProjectMain, stopProjectMain } from './project-main.ts';
import type { DependencyManager } from './project-dependency-cache.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';

export const projectSchema = z
  .object({
    directory: z
      .string()
      .default('/workspace')
      .refine((value) => {
        try {
          guestPath(value);
          return true;
        } catch {
          return false;
        }
      }, '需要有效的 Linux 绝对路径'),
    template: z.enum(['none', 'node', 'python', 'rust']).default('none'),
    repository: z
      .string()
      .max(2048)
      .default('')
      .refine((v) => !v || /^https:\/\/[^\s]+$/.test(v), '仓库地址需要 HTTPS'),
    setup: z.string().max(8192).default(''),
    command: z.string().max(8192).default(''),
    previewPort: z.number().int().min(1024).max(65535).optional(),
    networkIsolation: z.enum(['host', 'private']).optional(),
    environment: environmentSchema.optional(),
    secrets: secretRefsSchema.optional(),
    runtimes: runtimesSchema.optional(),
    services: z.array(serviceSchema).max(12).optional(),
  })
  .strict()
  .superRefine((project, ctx) => {
    try {
      serviceOrder(project.services || []);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['services'] });
    }
    if (project.networkIsolation === 'private' && project.previewPort)
      ctx.addIssue({ code: 'custom', message: '私有网络命名空间不开放 Windows 预览端口',
        path: ['previewPort'] });
  });
export type Project = z.infer<typeof projectSchema> & { _workspace?: string };
export const projectVersion = (project: Project) => createHash('sha256')
  .update(JSON.stringify(project)).digest('hex');
export const projectSession = mainSession;
export const projectLog = mainLog;
export type ProjectRuntime = { status: string; log: string;
  services?: { name: string; status: string; log: string }[]; main?: { status: string } };
function runtimeLogCommand(path: string, limit: 8192 | 16384) {
  if (!/^\/tmp\/(?:sakura-project(?:-[a-f0-9]{16})?|sakura-service-(?:[a-f0-9]{16}-)?[a-z][a-z0-9-]{0,31})\.log$/.test(path))
    throw new AppError('项目日志路径无法核对', 409);
  const source = `import os,stat,sys
path=${JSON.stringify(path)}; limit=${limit}
try:
 try: descriptor=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 except FileNotFoundError: sys.exit(0)
 try:
  info=os.fstat(descriptor)
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:
   raise RuntimeError('日志文件归属、类型或权限无法核对')
  os.lseek(descriptor,max(0,info.st_size-limit),os.SEEK_SET)
  sys.stdout.buffer.write(os.read(descriptor,limit))
 finally: os.close(descriptor)
except Exception as error:
 print('SAKURA_PROJECT_RUNTIME_LOG_REFUSED: '+str(error),file=sys.stderr);sys.exit(73)
`;
  return '# SAKURA_PROJECT_RUNTIME_LOG\n' +
    `if [ ! -x /usr/bin/python3 ]; then echo 'SAKURA_PROJECT_RUNTIME_LOG_REFUSED: 缺少系统 Python；未读取未确认的 root 日志' >&2; exit 73; fi\n` +
    `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`;
}
export function projectPrivateValues(project: Project) {
  return [
    ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''),
    ...(project.services || []).flatMap((service) =>
      Object.keys(service.secrets || {}).map((key) => service.environment?.[key] || ''),
    ),
  ].filter(Boolean);
}
export function setupFingerprint(project: Project) {
  const { directory, template, repository, setup, environment, networkIsolation } = project;
  return createHash('sha256')
    .update(
      JSON.stringify({
        directory,
        template,
        repository,
        setup,
        networkIsolation: networkIsolation || 'host',
        ...(environment && Object.keys(environment).length ? { environment } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16);
}
export function provisionScript(template: Project['template'], distro = 'alpine') {
  const packages =
    distro === 'alpine'
      ? {
          none: 'git tmux',
          node: 'git tmux nodejs npm',
          python: 'git tmux python3 py3-pip',
          rust: 'git tmux rust cargo build-base',
        }
      : {
          none: 'git tmux',
          node: 'git tmux nodejs npm',
          python: 'git tmux python3 python3-pip python3-venv',
          rust: 'git tmux rustc cargo build-essential',
        };
  const install =
    distro === 'alpine'
      ? `apk add --no-cache --timeout 30 ${packages[template]}`
      : `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update &&\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y ${packages[template]}`;
  return `set -eu\nsakura_attempt=0\nuntil (\nset -e\n${install}\n); do\n  sakura_attempt=$((sakura_attempt + 1))\n  [ "$sakura_attempt" -lt 3 ] || exit 1\n  echo '软件源暂时不可用，正在重试…'\n  sleep 2\ndone\nmkdir -p /etc/sakura /workspace\ntouch /etc/sakura/template-${template}\n`;
}
export class Workspaces {
  jobs = new Jobs('projects');
  projects: ProjectCatalog;
  private configListeners = new Set<() => Promise<void>>();
  private configGuards = new Set<(id: string, previous: Project, next: Project) => Promise<void>>();
  private observed = new Map<string, string>();
  private sampler: Metrics;
  onAction?: (id: string, action: 'start' | 'stop', service?: string) => Promise<(success: boolean) => void>;
  constructor(
    private machines: Machines,
    private context?: { secrets?: Secrets; network?: NetworkProfiles },
  ) {
    this.sampler = new Metrics(machines);
    this.projects = new ProjectCatalog(machines);
    machines.on('change', this.onChange);
  }
  private onChange = () => {
    for (const id of this.observed.keys()) if (!this.machines.records.has(id)) this.observed.delete(id);
    const machines = this.machines;
    for (const [id, vm] of machines.records) {
      const live = machines.live.get(id);
      if (!live || live.status !== 'running') {
        for (const job of this.jobs.list())
          if (job.vmId === id && job.status === 'running') this.jobs.cancel(job.id!);
        this.sampler.forget(id);
        continue;
      }
      const boot = `${id}:${live.startedAt}`;
      if (vm.template && vm.template !== 'none' && this.observed.get(id) !== boot) {
        if (this.jobs.view(this.projects.key(id))?.status === 'running') continue;
        this.observed.set(id, boot);
        this.jobs.start(
          this.projects.key(id),
          async (log, signal) => {
            const check = await machines.exec(
              id,
              `test -f /etc/sakura/template-${vm.template}`,
              10000,
              signal,
            );
            if (check.code === 0) {
              log('开发环境已安装。\n');
              return;
            }
            await this.execute(id, provisionScript(vm.template!, vm.distro), log, signal);
          },
          { title: '安装开发环境', vmId: id, action: 'setup' },
        );
      }
    }
  };
  async close() {
    this.machines.off('change', this.onChange);
    this.observed.clear();
    this.configListeners.clear();
    this.configGuards.clear();
    await Promise.all([this.jobs.close(), this.sampler.close()]);
  }
  onConfigChange(listener: () => Promise<void>) {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }
  beforeConfigChange(guard: (id: string, previous: Project, next: Project) => Promise<void>) {
    this.configGuards.add(guard);
    return () => this.configGuards.delete(guard);
  }
  async config(id: string): Promise<Project> {
    const vm = this.machines.get(id);
    const scope = this.projects.current(id);
    const contextual = (project: Project) =>
      Object.defineProperty(project, '_workspace', {
        value: scope === 'default' ? undefined : scope,
        enumerable: false,
      });
    try {
      return contextual(projectSchema.parse(JSON.parse(await readFile(this.projects.file(id), 'utf8'))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return contextual(projectSchema.parse({ template: vm.template || 'none' }));
    }
  }
  networkEnvironment(id: string) {
    return this.context?.network?.environment(id) || Promise.resolve({});
  }
  async dependencyDownloadAuthentication(id: string, manager: DependencyManager) {
    const state = await this.context?.network?.state(id);
    const configuration = state?.appliedAt ? state.config.dependencyDownloads?.[manager] : undefined;
    return configuration
      ? resolveDependencyAuthentication(id, configuration, this.context?.secrets)
      : undefined;
  }
  async resolvedConfig(id: string): Promise<Project> {
    const project = await this.config(id);
    if (
      !this.context?.secrets &&
      (Object.keys(project.secrets || {}).length ||
        project.services?.some((service) => Object.keys(service.secrets || {}).length))
    )
      throw new AppError('项目引用了私密配置，请先启用 secrets 插件', 409);
    const environment = {
      ...(await this.networkEnvironment(id)),
      ...project.environment,
      ...(await this.context?.secrets?.resolve(id, project.secrets)),
      ...runtimeEnvironment(project.runtimes, project.environment?.PATH),
    };
    const services = project.services
      ? await Promise.all(
          project.services.map(async (service) => ({
            ...service,
            environment: {
              ...service.environment,
              ...(await this.context?.secrets?.resolve(id, service.secrets)),
            },
          })),
        )
      : undefined;
    return { ...project, _workspace: project._workspace, environment, ...(services ? { services } : {}) };
  }
  async save(id: string, input: unknown, allowedDirectory?: string, expectedVersion?: string) {
    const project = projectSchema.parse(input);
    return this.machines.locked(id, async () => {
      this.machines.get(id);
      if (this.jobs.view(this.projects.key(id))?.status === 'running')
        throw new AppError('请等待项目操作完成', 409);
      const previous = await this.config(id);
      if (expectedVersion !== undefined && projectVersion(previous) !== expectedVersion)
        throw new AppError('项目配置已变化，请重新审阅并提交变更', 409);
      if (allowedDirectory !== undefined &&
          (project.directory !== allowedDirectory || previous.directory !== allowedDirectory))
        throw new AppError('项目成员不能修改项目目录', 403);
      for (const guard of this.configGuards) await guard(id, previous, project);
      const mainBindingInput = (value: Project) => JSON.stringify([value.directory, value.command,
        value.networkIsolation || 'host', value.environment || {}, value.secrets || {}, value.runtimes || {},
        Boolean(value.services?.length)]);
      const identityBindingInput = (value: Project) => JSON.stringify([mainBindingInput(value),
        (value.services || []).map(service => [service.name, service.command, service.environment || {}, service.secrets || {}])]);
      if (mainBindingInput(previous) !== mainBindingInput(project)) {
        const mainScope = new ProjectMainScope(this.machines, id, previous);
        const hasReceipt = await mainScope.hasReceipt(), machineState = this.machines.state(id);
        if (machineState === 'paused') {
          if (!hasReceipt || (await mainScope.metadata())?.phase !== 'stopped')
            throw new AppError('请先恢复实例并核对或停止项目主命令，再修改运行绑定或切换到服务模式', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
        } else if (machineState === 'running') {
          if (hasReceipt) {
            const runtime = await mainScope.status();
            if (runtime.status !== 'stopped' && runtime.status !== 'absent')
              throw new AppError('请先确认停止项目主命令及其全部后代，再修改运行绑定或切换到服务模式', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
          } else if (await legacyMainStatus(this.machines, id, previous) === 'unmanaged') {
            throw new AppError('旧项目主命令缺少受管归属，请管理员检查并关闭旧会话及其后代后再修改运行绑定', 409, 'PROJECT_MAIN_SCOPE_UNMANAGED');
          }
        }
      }
      // Persistent service receipts retain detached descendants even after the
      // original tmux pane exits. Binding edits must keep that stop reachable.
      const serviceBindingInput = (value: Project, service: ProjectService) =>
        JSON.stringify([value.directory, value.networkIsolation || 'host', value.environment || {},
          value.secrets || {}, value.runtimes || {}, service.command, service.environment || {}, service.secrets || {}]);
      const serviceScopes = new ProjectServiceScopes(this.machines, id, previous);
      for (const service of previous.services || []) {
        const next = project.services?.find(item => item.name === service.name);
        if (next && serviceBindingInput(previous, service) === serviceBindingInput(project, next)) continue;
        const machineState = this.machines.state(id);
        if (!await serviceScopes.hasReceipt(service.name)) {
          if (machineState === 'paused')
            throw new AppError(`服务 ${service.name} 缺少可验证归属；请先恢复实例核对或关闭旧会话及其后代，再修改服务绑定或移除服务`,
              409, 'SERVICE_SCOPE_UNMANAGED');
          if (machineState === 'running') {
            const old = await this.machines.exec(id,
              `if tmux has-session -t =sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${service.name} 2>/dev/null; then echo active; fi`, 10000);
            if (old.code !== 0) throw new AppError('无法检查旧服务会话', 409);
            if (old.stdout.includes('active'))
              throw new AppError('旧服务缺少受管归属，请明确关闭旧会话后重新启动，再修改服务绑定或移除服务', 409, 'SERVICE_SCOPE_UNMANAGED');
          }
          continue;
        }
        if (machineState === 'paused') {
          if ((await serviceScopes.metadata(service.name))?.phase !== 'stopped')
            throw new AppError('请先恢复实例并确认停止受管服务，再修改服务绑定或移除服务', 409);
          continue;
        }
        if (machineState !== 'running') continue;
        const runtime = await serviceScopes.status(service.name);
        if (runtime.status !== 'stopped' && runtime.status !== 'absent')
          throw new AppError('请先确认停止受管服务及其全部后代，再修改服务绑定或移除服务', 409, 'SERVICE_SCOPE_CHANGED');
      }
      if (identityBindingInput(previous) !== identityBindingInput(project))
        await new ProjectRunScopes(this.machines).guard(id, this.projects.current(id));
      if (previous.directory !== project.directory ||
          (previous.networkIsolation || 'host') !== (project.networkIsolation || 'host')) {
        if (this.machines.state(id) === 'paused')
          throw new AppError('请先恢复实例并停止项目终端，再修改目录或网络模式', 409);
        if (this.machines.state(id) === 'running') {
          const sshBusy = await this.machines.exec(id,
            projectSshBusyScript(this.projects.current(id)), 10_000);
          if (sshBusy.code !== 0) throw new AppError('无法检查项目 SSH 绑定', 409);
          if (sshBusy.stdout.includes('SAKURA_PROJECT_SSH_BUSY'))
            throw new AppError('请先停止项目 SSH 及其编辑器进程，再修改目录或网络模式', 409);
          // Keep existing Docker bindings protected even when its plugin is
          // disabled or the host service has been reloaded.
          const paths=privateDockerPaths(this.projects.current(id));
          const dockerPresent=await this.machines.exec(id,
            `if [ -e ${quote(paths.config+'/binding.json')} ] || [ -d ${quote(paths.data)} ] || [ -S ${quote(paths.socket)} ]; then echo SAKURA_PROJECT_DOCKER_PRESENT; fi`,10_000);
          if (dockerPresent.code!==0) throw new AppError('无法检查项目 Docker 绑定',409);
          if (dockerPresent.stdout.includes('SAKURA_PROJECT_DOCKER_PRESENT')) {
            const runtime=await privateDockerStatus(this.machines,id,previous);
            if (runtime.running || runtime.containers)
              throw new AppError('请先移除项目容器并停止私有 Docker 环境，再修改目录或网络模式',409);
          }
          if (project.networkIsolation==='private' && previous.networkIsolation!=='private') {
            const projectId=this.projects.current(id);
            const script=`set -eu\nif ! command -v docker >/dev/null; then exit 0; fi\n`+
              `docker --host unix:///var/run/docker.sock version >/dev/null\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=sakura.vm='+id)} --filter ${quote('label=sakura.project='+projectId)}\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=com.docker.compose.project=sakura-'+id.slice(0,8)+'-'+projectId)}\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=devcontainer.local_folder='+previous.directory)}\n`;
            const sharedDocker=await this.machines.exec(id,
              `env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /bin/sh -c ${quote(script)}`,15_000);
            if (sharedDocker.code!==0) throw new AppError('无法核对共享 Docker 的旧项目容器，请先恢复 Docker 并移除容器',409);
            if (sharedDocker.stdout.trim()) throw new AppError('请先移除旧项目容器，再修改目录或网络模式',409);
          }
          const prefix = terminalSessionPrefix(this.projects.current(id));
          const check = await this.machines.exec(id, `set -eu\n` +
            `if command -v tmux >/dev/null && tmux list-sessions -F '#{session_name}' >/dev/null 2>&1; then\n` +
            `  sakura_sessions=$(tmux list-sessions -F '#{session_name}')\n` +
            `  for sakura_session in $sakura_sessions; do\n` +
            `    case "$sakura_session" in ${prefix}*) echo active;; esac\n` +
            `  done\nfi`, 10000);
          if (check.code !== 0) throw new AppError(check.stderr || '无法检查项目终端状态', 409);
          if (check.stdout.includes('active'))
            throw new AppError('请先停止此项目的所有终端，再修改目录或网络模式', 409);
        }
      }
      await guardProjectQuotaDirectory(
        id, this.projects.current(id), project.directory,
        (await this.projects.list(id)).projects.map((item) => item.id),
      );
      const removed = (previous.services || [])
        .filter((s) => !project.services?.some((next) => next.name === s.name))
        .map((s) => `sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${s.name}`);
      if (!previous.services?.length && project.services?.length) removed.push(projectSession(previous));
      if (removed.length && this.machines.state(id) === 'running') {
        const check = await this.machines.exec(
          id,
          removed
            .map((name) => `if tmux has-session -t =${name} 2>/dev/null; then echo ${name}; fi`)
            .join('\n'),
          10000,
        );
        if (check.stdout.trim()) throw new AppError('请先停止要移除或替换的运行服务', 409);
      }
      if ((previous.networkIsolation || 'host') !== (project.networkIsolation || 'host') &&
          this.machines.state(id) === 'running') {
        const sessions = [projectSession(previous),
          ...(previous.services || []).map((item) =>
            `sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${item.name}`),
          `sakura-notebook-${this.projects.current(id)}`,
          `sakura-browser-ide-${this.projects.current(id)}`,
          `sakura-mesh-${this.projects.current(id)}`];
        const check = await this.machines.exec(id,
          sessions.map((name) => `tmux has-session -t =${name} 2>/dev/null && echo active || true`)
            .join('\n'), 10000);
        if (check.stdout.includes('active'))
          throw new AppError('请先停止运行中的项目，再切换网络隔离模式', 409);
      }
      if (previous.networkIsolation === 'private' && project.networkIsolation !== 'private' &&
          this.machines.state(id) === 'running') {
        const identities = new ProjectRunScopes(this.machines), projectId = this.projects.current(id);
        const lease = await identities.beginNetworkRelease(id, projectId);
        if (lease) await identities.releaseNetwork(id, projectId, lease);
        else await removeProjectNetwork(this.machines, id, previous);
      }
      const file = this.projects.file(id);
      await writeFile(`${file}.tmp`, JSON.stringify(project, null, 2));
      await rename(`${file}.tmp`, file);
      await Promise.allSettled([...this.configListeners].map((listener) => listener()));
      return project;
    });
  }
  async view(id: string) {
    const project = await this.config(id);
    return {
      project,
      version: projectVersion(project),
      projectId: this.projects.current(id),
      job: this.jobs.view(this.projects.key(id)),
    };
  }
  private async execute(id: string, script: string, log: (text: string) => void, signal: AbortSignal) {
    const result = await guestTask(this.machines, id,
      `/usr/bin/env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`,
      signal, log);
    if (result.code !== 0) throw new Error(result.stderr.slice(-2000) || `命令退出码 ${result.code}`);
  }
  async run(
    id: string,
    action: 'setup' | 'start' | 'stop' | 'terminal',
    service?: string,
    automatic = false,
  ) {
    return this.machines.locked(id, async () => {
      const finish =
        !automatic && (action === 'start' || action === 'stop')
          ? await this.onAction?.(id, action, service)
          : undefined;
      try {
        const job = await this.runInternal(id, action, service);
        if (finish) void this.jobs.wait(this.projects.key(id)).then(() => finish(job.status === 'done'));
        return job;
      } catch (error) {
        finish?.(false);
        throw error;
      }
    });
  }
  private async runInternal(id: string, action: 'setup' | 'start' | 'stop' | 'terminal', service?: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if ((action === 'setup' || action === 'start') &&
        await readProjectQuotaRecord(id, this.projects.current(id))) {
      const quota = await projectQuota(this.machines, this, id, {}, 'check');
      if (!quota.ready || !quota.active)
        throw new AppError('项目配额未挂载；拒绝在未受限的目录中启动项目', 409);
    }
    const project =
      action === 'stop' || action === 'terminal' ? await this.config(id) : await this.resolvedConfig(id);
    const distro = this.machines.get(id).distro;
    if (service && !project.services?.some((s) => s.name === service)) throw new AppError('服务不存在');
    return this.jobs.start(
      this.projects.key(id),
      async (rawLog, signal) => {
        const privateValues = projectPrivateValues(project);
        const output = privateLog(rawLog, privateValues),
          log = output.write;
        try {
          if (action === 'stop') {
            const identities = new ProjectRunScopes(this.machines), projectId = this.projects.current(id);
            // Capture and freeze this network generation before asynchronous
            // scope cleanup. A late retry must never acquire a later network.
            const lease = !service && project.networkIsolation === 'private'
              ? await identities.beginNetworkRelease(id, projectId, signal) : null;
            if (project.services?.length) {
              await runServices(this.machines, id, project, 'stop', log, signal, service);
              if (service) return;
            }
            await stopProjectMain(this.machines, id, project, log, signal);
            if (lease) await identities.releaseNetwork(id, projectId, lease, signal);
            else await removeProjectNetwork(this.machines, id, project, signal);
            return;
          }
          if (action === 'terminal') {
            await this.execute(id, provisionScript('none', distro), log, signal);
            return;
          }
          // Main scope prerequisites can install before prepareProject runs.
          // Reject old retirement intent before admitting any such mutation.
          await new ProjectRunScopes(this.machines).assertAdmission(id, this.projects.current(id));
          const install =
            action === 'setup'
              ? provisionScript(project.template, distro)
              : `if [ ! -f /etc/sakura/template-${project.template} ] || ! command -v tmux >/dev/null; then\n${provisionScript(project.template, distro)}\nfi\n`;
          const network = ensureProjectNetworkScript(project, distro || 'alpine');
          // Previous markers certify a root setup, not setup by this account.
          const marker = `/etc/sakura/project-setup-uid1-${setupFingerprint(project)}`;
          log(action === 'setup' ? '正在安装环境并准备项目…\n' : '正在启动项目…\n');
          const prepareProject = async () => {
            await new ProjectRunScopes(this.machines).assertAdmission(id, this.projects.current(id));
            // Trusted installation/network control has no project environment,
            // repository, directory hooks or project command in its argv.
            await this.execute(id, `set -eu\n${install}\n${network}`, log, signal);
            await new ProjectRunScopes(this.machines).identity(id, project, signal);
            let setupNeeded = Boolean(project.setup.trim());
            if (setupNeeded && action !== 'setup') {
              const done = await this.machines.exec(id, `test -f ${marker}`, 10000, signal);
              setupNeeded = done.code !== 0;
            }
            let prepare = 'set -eu\n';
            if (project.repository) {
              prepare += 'if [ ! -e .git ]; then\n';
              if (project.networkIsolation === 'private')
                prepare += `printf '%s\\n' 'PROJECT_PRIVATE_REPOSITORY_REQUIRED: 私有项目请先通过受限下载入口准备本地仓库；项目账号不会降级到共享网络执行 Git。' >&2\nexit 73\n`;
              else prepare += `git clone -- ${quote(project.repository)} .\n`;
              prepare += 'fi\n';
            }
            if (setupNeeded) prepare += project.setup + '\n';
            if (project.repository || setupNeeded) {
              const result = await projectIdentityTask(this.machines, id, project,
                { command: prepare, environment: project.environment }, signal, log);
              if (result.code !== 0) {
                const privateRepository = result.stderr.includes('PROJECT_PRIVATE_REPOSITORY_REQUIRED');
                throw new AppError(result.stderr.slice(-2000) || `项目账号准备命令退出码 ${result.code}`, 409,
                  privateRepository ? 'PROJECT_PRIVATE_REPOSITORY_REQUIRED' : 'PROJECT_SETUP_FAILED');
              }
            }
            // Only the clean controller publishes /etc markers, after task
            // descendants and the account ticket have both been retired.
            if (setupNeeded) await this.execute(id, `set -eu\ntouch ${marker}`, log, signal);
          };
          if (action === 'start' && !project.services?.length)
            await runProjectMain(this.machines, id, project, log, signal, prepareProject);
          else await prepareProject();
          if (action === 'start' && project.services?.length)
            await runServices(this.machines, id, project, 'start', log, signal, service);
          log('操作完成。\n');
        } catch (error) {
          throw new AppError(redactValues((error as Error).message, privateValues),
            error instanceof AppError ? error.status : 400, error instanceof AppError ? error.code : undefined);
        } finally {
          output.flush();
        }
      },
      {
        title: `项目${{ setup: '初始化', start: '启动', stop: '停止', terminal: '终端安装' }[action]}${service ? ` · ${service}` : ''}`,
        vmId: id,
        projectId: this.projects.current(id),
        action: service ? `${action}:${service}` : action,
      },
    );
  }
  async runtime(id: string, signal?: AbortSignal): Promise<ProjectRuntime> {
    const project = await this.resolvedConfig(id);
    const privateValues = projectPrivateValues(project);
    if (project.services?.length) {
      const services = [];
      const scopes = new ProjectServiceScopes(this.machines, id, project);
      for (const service of project.services) {
        if (await scopes.hasReceipt(service.name)) {
          let status: string, reason = '';
          try {
            const runtime = await scopes.status(service.name, signal);
            status = runtime.status === 'absent' ? 'stopped' : runtime.status;
            if (runtime.record && ['running', 'exited', 'stopped'].includes(runtime.status)) {
              const identities = new ProjectRunScopes(this.machines);
              if (await identities.hasRun(id, runtime.record.projectId, runtime.record.runId)) {
                const active = await identities.readonlyActive(id, runtime.record.projectId, runtime.record.runId, signal);
                if (active !== (runtime.status !== 'stopped'))
                  throw new AppError('服务 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'SERVICE_SCOPE_CHANGED');
              } else if (runtime.status === 'running') {
                status = 'unconfirmed';
                reason = '此旧服务尚未接入项目账号；请先确认停止全部后代后重新启动。';
              }
            }
            if (status === 'exited') reason = '主 pane 已退出，仍保留服务归属；请停止并清理全部后代。';
            else if (status === 'prepared' || status === 'unconfirmed') reason = '服务启动或停止尚未确认；请先确认停止再重建。';
          } catch (error) {
            signal?.throwIfAborted();
            status = 'unconfirmed';
            reason = error instanceof Error ? error.message : String(error);
          }
          const output = await this.machines.exec(id,
            runtimeLogCommand(serviceLog(service.name, project), 8192),
            10000, signal).catch((error) => {
              signal?.throwIfAborted();
              return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
            });
          if (output.code !== 0) { status = 'unconfirmed'; reason += '\n服务日志读取未确认：' + output.stderr; }
          services.push({ name: service.name, status, log: redactValues([reason, output.stdout].filter(Boolean).join('\n'), privateValues) });
          continue;
        }
        const result = await this.machines.exec(
          id,
          `if tmux has-session -t =sakura-service-${project._workspace ? project._workspace + '-' : ''}${service.name} 2>/dev/null; then echo running; else echo stopped; fi`,
          10000,
          signal,
        );
        const status = result.stdout.split('\n')[0].trim();
        services.push({ name: service.name,
          status: result.code !== 0 || !['running', 'stopped'].includes(status) ? 'unconfirmed'
            : status === 'running' ? 'migration-required' : status,
          log: redactValues(result.code !== 0 || !['running', 'stopped'].includes(status)
            ? '旧服务状态读取未确认：' + result.stderr
            : status === 'running' ? '此旧服务尚未迁移到受管归属；请明确关闭旧会话后重新启动。旧日志归属无法核对，未读取。' : '', privateValues) });
      }
      return {
        status: services.some((s) => ['unconfirmed', 'prepared', 'migration-required'].includes(s.status))
          ? 'unconfirmed'
          : services.every((s) => s.status === 'running')
          ? 'running'
          : services.some((s) => s.status === 'running')
            ? 'partial'
            : services.some(s => s.status === 'exited') ? 'exited' : 'stopped',
        log: '',
        services,
      };
    }
    const mainScope = new ProjectMainScope(this.machines, id, project);
    let status: string, mainStatus: string, reason = '';
    let hasMainReceipt = false;
    try {
      hasMainReceipt = await mainScope.hasReceipt();
      const owned = hasMainReceipt ? await mainScope.status(signal) : null;
      let runtime = owned?.status || await legacyMainStatus(this.machines, id, project, signal);
      if (owned?.record && ['running', 'exited', 'stopped'].includes(runtime)) {
        const identities = new ProjectRunScopes(this.machines);
        if (await identities.hasRun(id, owned.record.projectId, owned.record.runId)) {
          const active = await identities.readonlyActive(id, owned.record.projectId, owned.record.runId, signal);
          if (active !== (runtime !== 'stopped'))
            throw new AppError('主命令 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
        } else if (runtime === 'running') {
          runtime = 'unconfirmed';
          reason = '此旧项目主命令尚未接入项目账号；请先确认停止全部后代后重新启动。';
        }
      }
      mainStatus = runtime;
      status = runtime === 'absent' ? 'stopped' : ['prepared', 'unmanaged'].includes(runtime) ? 'unconfirmed' : runtime;
      if (runtime === 'exited') reason = '项目主命令主 pane 已退出，仍保留运行归属；请停止并清理全部后代。';
      else if (runtime === 'unmanaged') reason = '旧项目主命令缺少可验证归属；请管理员检查并关闭旧会话及其后代后重新启动，未自动停止任何进程。' +
        (!hasMainReceipt ? '旧日志归属无法核对，未读取。' : '');
      else if ((runtime === 'prepared' || runtime === 'unconfirmed') && !reason) reason = '项目主命令启动或停止尚未确认；请先确认停止再重建。';
    } catch (error) {
      signal?.throwIfAborted();
      status = 'unconfirmed'; mainStatus = (error as AppError).code === 'PROJECT_MAIN_SCOPE_UNMANAGED' ? 'unmanaged' : 'unconfirmed';
      reason = error instanceof Error ? error.message : String(error);
    }
    const output = hasMainReceipt ? await this.machines.exec(id,
      runtimeLogCommand(projectLog(project), 16384), 10000, signal)
      .catch((error) => {
        signal?.throwIfAborted();
        return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
      }) : { code: 0, stdout: '', stderr: '' };
    if (output.code !== 0) { status = 'unconfirmed'; reason += '\n主命令日志读取未确认：' + output.stderr; }
    return { status, log: redactValues([reason, output.stdout].filter(Boolean).join('\n'), privateValues), main: { status: mainStatus } };
  }
  metrics(id: string) {
    return this.sampler.sample(id);
  }
}
