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
  envPrefix,
} from './project-services.ts';
import { guestTask } from './guest-task.ts';
import { secretRefsSchema, privateLog, redactValues, type Secrets } from './secrets.ts';
import type { NetworkProfiles } from './network-profiles.ts';
import { ProjectCatalog } from './project-catalog.ts';
import { runtimesSchema, runtimeEnvironment } from './runtime-versions.ts';
import { guardProjectQuotaDirectory, projectQuota, readProjectQuotaRecord } from './project-quota.ts';

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
  });
export type Project = z.infer<typeof projectSchema> & { _workspace?: string };
export const projectSession = (project: Project) =>
  project._workspace ? `sakura-project-${project._workspace}` : 'sakura-project';
export const projectLog = (project: Project) => `/tmp/${projectSession(project)}.log`;
export function projectPrivateValues(project: Project) {
  return [
    ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''),
    ...(project.services || []).flatMap((service) =>
      Object.keys(service.secrets || {}).map((key) => service.environment?.[key] || ''),
    ),
  ].filter(Boolean);
}
export function setupFingerprint(project: Project) {
  const { directory, template, repository, setup, environment } = project;
  return createHash('sha256')
    .update(
      JSON.stringify({
        directory,
        template,
        repository,
        setup,
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
    await Promise.all([this.jobs.close(), this.sampler.close()]);
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
  async resolvedConfig(id: string): Promise<Project> {
    const project = await this.config(id);
    if (
      !this.context?.secrets &&
      (project.secrets?.length || project.services?.some((service) => service.secrets?.length))
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
  async save(id: string, input: unknown) {
    const project = projectSchema.parse(input);
    return this.machines.locked(id, async () => {
      this.machines.get(id);
      if (this.jobs.view(this.projects.key(id))?.status === 'running')
        throw new AppError('请等待项目操作完成', 409);
      const previous = await this.config(id);
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
      const file = this.projects.file(id);
      await writeFile(`${file}.tmp`, JSON.stringify(project, null, 2));
      await rename(`${file}.tmp`, file);
      return project;
    });
  }
  async view(id: string) {
    return {
      project: await this.config(id),
      projectId: this.projects.current(id),
      job: this.jobs.view(this.projects.key(id)),
    };
  }
  private async execute(id: string, script: string, log: (text: string) => void, signal: AbortSignal) {
    const result = await guestTask(this.machines, id, script, signal, log);
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
            if (project.services?.length) {
              await runServices(this.machines, id, project, 'stop', log, signal, service);
              if (service) return;
            }
            await this.execute(
              id,
              `if command -v tmux >/dev/null && tmux has-session -t =${projectSession(project)} 2>/dev/null; then tmux kill-session -t =${projectSession(project)}; fi`,
              log,
              signal,
            );
            return;
          }
          if (action === 'terminal') {
            await this.execute(id, provisionScript('none', distro), log, signal);
            return;
          }
          const install =
            action === 'setup'
              ? provisionScript(project.template, distro)
              : `if [ ! -f /etc/sakura/template-${project.template} ] || ! command -v tmux >/dev/null; then\n${provisionScript(project.template, distro)}\nfi\n`;
          let prepare = `mkdir -p ${quote(project.directory)}\n`;
          if (project.repository)
            prepare += `if [ ! -e ${quote(project.directory + '/.git')} ]; then git clone -- ${quote(project.repository)} ${quote(project.directory)}; fi\n`;
          const marker = `/etc/sakura/project-setup-${setupFingerprint(project)}`;
          const legacy = `/etc/sakura/project-${createHash('sha256').update(JSON.stringify(project)).digest('hex').slice(0, 16)}`;
          if (project.setup.trim())
            prepare += `if ${action === 'setup' ? 'true' : `[ ! -f ${marker} ] && [ ! -f ${legacy} ]`}; then\ncd ${quote(project.directory)}\n${project.setup}\nfi\ntouch ${marker}\n`;
          if (action === 'start' && !project.services?.length) {
            if (!project.command.trim()) throw new AppError('请先保存项目启动命令');
            prepare += `tmux new-session -d -s ${projectSession(project)} -c ${quote(project.directory)} ${quote(`sh -lc ${quote(`${envPrefix(project.environment)}\n${project.command}`)} > ${projectLog(project)} 2>&1`)}\nsleep 1\nif ! tmux has-session -t =${projectSession(project)} 2>/dev/null; then tail -c 8192 ${projectLog(project)}; echo '启动命令已退出，请检查日志' >&2; exit 1; fi\n`;
          }
          log(action === 'setup' ? '正在安装环境并准备项目…\n' : '正在启动项目…\n');
          const running =
            action === 'start' && !project.services?.length
              ? `if command -v tmux >/dev/null && tmux has-session -t =${projectSession(project)} 2>/dev/null; then echo '项目已经运行；如需应用新的启动配置，请先停止项目'; exit 0; fi\n`
              : '';
          await this.execute(
            id,
            `set -eu\n${running}${envPrefix(project.environment)}\n${install}\n${prepare}`,
            log,
            signal,
          );
          if (action === 'start' && project.services?.length)
            await runServices(this.machines, id, project, 'start', log, signal, service);
          log('操作完成。\n');
        } catch (error) {
          throw new AppError(redactValues((error as Error).message, privateValues));
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
  async runtime(id: string, signal?: AbortSignal) {
    const project = await this.resolvedConfig(id);
    const privateValues = projectPrivateValues(project);
    if (project.services?.length) {
      const services = [];
      for (const service of project.services) {
        const result = await this.machines.exec(
          id,
          `if tmux has-session -t =sakura-service-${project._workspace ? project._workspace + '-' : ''}${service.name} 2>/dev/null; then echo running; else echo stopped; fi; test ! -f ${quote(serviceLog(service.name, project))} || tail -c 8192 ${quote(serviceLog(service.name, project))}`,
          10000,
          signal,
        );
        const [status, ...lines] = result.stdout.split('\n');
        services.push({ name: service.name, status, log: redactValues(lines.join('\n'), privateValues) });
      }
      return {
        status: services.every((s) => s.status === 'running')
          ? 'running'
          : services.some((s) => s.status === 'running')
            ? 'partial'
            : 'stopped',
        log: '',
        services,
      };
    }
    const result = await this.machines.exec(
      id,
      `if command -v tmux >/dev/null && tmux has-session -t =${projectSession(project)} 2>/dev/null; then echo running; else echo stopped; fi; test ! -f ${projectLog(project)} || tail -c 16384 ${projectLog(project)}`,
      10000,
      signal,
    );
    const [status, ...lines] = result.stdout.split('\n');
    return { status, log: redactValues(lines.join('\n'), privateValues) };
  }
  metrics(id: string) {
    return this.sampler.sample(id);
  }
}
