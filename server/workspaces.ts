import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError, vmDir, guestPath } from './model.ts';
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
export type Project = z.infer<typeof projectSchema>;
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
export const metricsScript = String.raw`set -eu
echo CPU
head -n 1 /proc/stat
sleep 0.25
head -n 1 /proc/stat
echo MEMORY
cat /proc/meminfo
echo DISK
df -Pk / | tail -n 1
echo PROCESSES
for p in /proc/[0-9]*; do
  [ -r "$p/status" ] || continue
  awk '/^Name:/ {n=$2} /^VmRSS:/ {m=$2} END {if(m) print m, n}' "$p/status" 2>/dev/null || true
done | sort -nr | head -n 8
echo UPTIME
cat /proc/uptime`;
export function parseMetrics(text: string) {
  const section = (name: string, next: string) => text.split(name + '\n')[1]?.split(next + '\n')[0] || '';
  const cpu = section('CPU', 'MEMORY')
    .trim()
    .split('\n')
    .map((s) => s.trim().split(/\s+/).slice(1, 9).map(Number));
  if (cpu.length !== 2 || cpu.some((row) => row.length !== 8 || row.some((n) => !Number.isFinite(n))))
    throw new AppError('无法解析 CPU 采样');
  const totals = cpu.map((row) => row.reduce((a, b) => a + b, 0));
  const total = totals[1] - totals[0],
    idle = cpu[1][3] + cpu[1][4] - cpu[0][3] - cpu[0][4];
  const mem = Object.fromEntries(
    [...section('MEMORY', 'DISK').matchAll(/^(\w+):\s+(\d+)/gm)].map((m) => [m[1], Number(m[2]) * 1024]),
  );
  const disk = section('DISK', 'PROCESSES').trim().split(/\s+/);
  return {
    cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0,
    memoryUsed: mem.MemTotal - (mem.MemAvailable ?? mem.MemFree),
    memoryTotal: mem.MemTotal,
    diskUsed: Number(disk[2]) * 1024,
    diskTotal: Number(disk[1]) * 1024,
    processes: section('PROCESSES', 'UPTIME')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => {
        const [rss, ...name] = s.trim().split(/\s+/);
        return { name: name.join(' '), memory: Number(rss) * 1024 };
      }),
    uptime: Number(text.split('UPTIME\n')[1]?.trim().split(' ')[0]),
    sampledAt: new Date().toISOString(),
  };
}
export class Workspaces {
  jobs = new Jobs('projects');
  private observed = new Map<string, string>();
  private samples = new Map<string, { at: number; promise: Promise<ReturnType<typeof parseMetrics>> }>();
  constructor(private machines: Machines) {
    machines.on('change', this.onChange);
  }
  private onChange = () => {
    for (const id of this.observed.keys()) if (!this.machines.records.has(id)) this.observed.delete(id);
    const machines = this.machines;
    for (const [id, vm] of machines.records) {
      const live = machines.live.get(id);
      if (!live || live.status !== 'running') {
        this.jobs.cancel(id);
        this.samples.delete(id);
        continue;
      }
      const boot = `${id}:${live.startedAt}`;
      if (vm.template && vm.template !== 'none' && this.observed.get(id) !== boot) {
        if (this.jobs.view(id)?.status === 'running') continue;
        this.observed.set(id, boot);
        this.jobs.start(
          id,
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
    this.samples.clear();
    this.observed.clear();
    await this.jobs.close();
  }
  async config(id: string): Promise<Project> {
    const vm = this.machines.get(id);
    try {
      return projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return projectSchema.parse({ template: vm.template || 'none' });
    }
  }
  async save(id: string, input: unknown) {
    const project = projectSchema.parse(input);
    return this.machines.locked(id, async () => {
      this.machines.get(id);
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待项目操作完成', 409);
      const previous = await this.config(id);
      const removed = (previous.services || [])
        .filter((s) => !project.services?.some((next) => next.name === s.name))
        .map((s) => `sakura-service-${s.name}`);
      if (!previous.services?.length && project.services?.length) removed.push('sakura-project');
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
      const file = join(vmDir(id), 'project.json');
      await writeFile(`${file}.tmp`, JSON.stringify(project, null, 2));
      await rename(`${file}.tmp`, file);
      return project;
    });
  }
  async view(id: string) {
    return { project: await this.config(id), job: this.jobs.view(id) };
  }
  private async execute(id: string, script: string, log: (text: string) => void, signal: AbortSignal) {
    const result = await guestTask(this.machines, id, script, signal, log);
    if (result.code !== 0) throw new Error(result.stderr.slice(-2000) || `命令退出码 ${result.code}`);
  }
  async run(id: string, action: 'setup' | 'start' | 'stop' | 'terminal', service?: string) {
    return this.machines.locked(id, () => this.runInternal(id, action, service));
  }
  private async runInternal(id: string, action: 'setup' | 'start' | 'stop' | 'terminal', service?: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const project = await this.config(id);
    const distro = this.machines.get(id).distro;
    if (service && !project.services?.some((s) => s.name === service)) throw new AppError('服务不存在');
    return this.jobs.start(
      id,
      async (log, signal) => {
        if (action === 'stop') {
          if (project.services?.length) {
            await runServices(this.machines, id, project, 'stop', log, signal, service);
            if (service) return;
          }
          await this.execute(
            id,
            'if command -v tmux >/dev/null && tmux has-session -t =sakura-project 2>/dev/null; then tmux kill-session -t =sakura-project; fi',
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
          prepare += `if [ ! -d ${quote(project.directory + '/.git')} ]; then git clone -- ${quote(project.repository)} ${quote(project.directory)}; fi\n`;
        const marker = `/etc/sakura/project-setup-${setupFingerprint(project)}`;
        const legacy = `/etc/sakura/project-${createHash('sha256').update(JSON.stringify(project)).digest('hex').slice(0, 16)}`;
        if (project.setup.trim())
          prepare += `if ${action === 'setup' ? 'true' : `[ ! -f ${marker} ] && [ ! -f ${legacy} ]`}; then\ncd ${quote(project.directory)}\n${project.setup}\nfi\ntouch ${marker}\n`;
        if (action === 'start' && !project.services?.length) {
          if (!project.command.trim()) throw new AppError('请先保存项目启动命令');
          prepare += `tmux new-session -d -s sakura-project -c ${quote(project.directory)} ${quote(`sh -lc ${quote(`${envPrefix(project.environment)}\n${project.command}`)} > /tmp/sakura-project.log 2>&1`)}\nsleep 1\nif ! tmux has-session -t =sakura-project 2>/dev/null; then tail -c 8192 /tmp/sakura-project.log; echo '启动命令已退出，请检查日志' >&2; exit 1; fi\n`;
        }
        log(action === 'setup' ? '正在安装环境并准备项目…\n' : '正在启动项目…\n');
        const running =
          action === 'start' && !project.services?.length
            ? "if command -v tmux >/dev/null && tmux has-session -t =sakura-project 2>/dev/null; then echo '项目已经运行；如需应用新的启动配置，请先停止项目'; exit 0; fi\n"
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
      },
      {
        title: `项目${{ setup: '初始化', start: '启动', stop: '停止', terminal: '终端安装' }[action]}${service ? ` · ${service}` : ''}`,
        vmId: id,
        action: service ? `${action}:${service}` : action,
      },
    );
  }
  async runtime(id: string, signal?: AbortSignal) {
    const project = await this.config(id);
    if (project.services?.length) {
      const services = [];
      for (const service of project.services) {
        const result = await this.machines.exec(
          id,
          `if tmux has-session -t =sakura-service-${service.name} 2>/dev/null; then echo running; else echo stopped; fi; test ! -f ${quote(serviceLog(service.name))} || tail -c 8192 ${quote(serviceLog(service.name))}`,
          10000,
          signal,
        );
        const [status, ...lines] = result.stdout.split('\n');
        services.push({ name: service.name, status, log: lines.join('\n') });
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
      'if command -v tmux >/dev/null && tmux has-session -t =sakura-project 2>/dev/null; then echo running; else echo stopped; fi; test ! -f /tmp/sakura-project.log || tail -c 16384 /tmp/sakura-project.log',
      10000,
      signal,
    );
    const [status, ...lines] = result.stdout.split('\n');
    return { status, log: lines.join('\n') };
  }
  metrics(id: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const previous = this.samples.get(id);
    if (previous && Date.now() - previous.at < 3000) return previous.promise;
    const promise = this.machines
      .exec(id, metricsScript, 10000)
      .then((result) => {
        if (result.code !== 0) throw new AppError('客户机采样失败', 502);
        return parseMetrics(result.stdout);
      })
      .catch((error) => {
        if (this.samples.get(id)?.promise === promise) this.samples.delete(id);
        throw error;
      });
    this.samples.set(id, { at: Date.now(), promise });
    return promise;
  }
}
