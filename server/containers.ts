import { posix } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, type Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { envPrefix } from './project-services.ts';
import { quote } from './files.ts';
import { repositoryPath } from './git-workbench.ts';
import { privateLog, redactValues } from './secrets.ts';

const containerId = z.string().regex(/^[a-f0-9]{12,64}$/);
const imageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/);
export const containerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.enum(['start', 'stop', 'restart', 'remove']), id: containerId }).strict(),
  z.object({ action: z.enum(['pull', 'remove-image']), image: imageName }).strict(),
  z
    .object({ action: z.enum(['compose-up', 'compose-down', 'compose-restart']), file: repositoryPath })
    .strict(),
]);
function jsonLines(text: string) {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
export class Containers {
  jobs = new Jobs('containers');
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  private supported(id: string) {
    const vm = this.machines.get(id);
    if (!vm.distro || vm.distro === 'alpine') throw new AppError('容器面板首版支持 Debian 和 Ubuntu');
    return vm;
  }
  async view(id: string, signal?: AbortSignal) {
    const vm = this.machines.get(id);
    if (!vm.distro || vm.distro === 'alpine')
      return {
        supported: false,
        installed: false,
        containers: [],
        images: [],
        volumes: [],
        files: [],
        job: this.jobs.view(id),
      };
    const result = await this.machines.exec(
      id,
      "if command -v docker >/dev/null; then docker version --format '{{.Server.Version}}'; else exit 127; fi",
      10000,
      signal,
    );
    if (result.code !== 0)
      return {
        supported: true,
        installed: result.code !== 127,
        available: false,
        error: result.stderr,
        containers: [],
        images: [],
        volumes: [],
        files: [],
        job: this.jobs.view(id),
      };
    const project = await this.workspaces.config(id);
    const data = await this.machines.exec(
      id,
      `set -e\ndocker ps -a --format '{{json .}}'\necho SAKURA_IMAGES\ndocker image ls --format '{{json .}}'\necho SAKURA_VOLUMES\ndocker volume ls --format '{{json .}}'\necho SAKURA_COMPOSE\nif docker compose version >/dev/null 2>&1; then docker compose version; elif command -v docker-compose >/dev/null; then docker-compose version --short; fi\necho SAKURA_FILES\n${['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].map((name) => `test ! -f ${quote(posix.join(project.directory, name))} || echo ${name}`).join('\n')}`,
      20000,
      signal,
    );
    if (data.code !== 0) throw new AppError(data.stderr || '无法读取 Docker 状态');
    const [containers, images, volumes, compose, files] = data.stdout.split(
      /SAKURA_(?:IMAGES|VOLUMES|COMPOSE|FILES)\r?\n/,
    );
    return {
      supported: true,
      installed: true,
      available: true,
      version: result.stdout.trim(),
      compose: compose.trim(),
      containers: jsonLines(containers),
      images: jsonLines(images),
      volumes: jsonLines(volumes),
      files: files.trim().split('\n').filter(Boolean),
      job: this.jobs.view(id),
    };
  }
  async logs(id: string, target: string, signal?: AbortSignal) {
    this.supported(id);
    containerId.parse(target);
    const project = await this.workspaces.resolvedConfig(id);
    const result = await this.machines.exec(id, `docker logs --tail 200 ${quote(target)}`, 10000, signal);
    if (result.code !== 0) throw new AppError('无法读取容器日志');
    return {
      log: redactValues((result.stdout + result.stderr).slice(-32768), projectPrivateValues(project)),
    };
  }
  async run(id: string, input: unknown) {
    const vm = this.supported(id),
      value = containerActionSchema.parse(input);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const project =
      value.action === 'install'
        ? { directory: '/workspace', environment: await this.workspaces.networkEnvironment(id) }
        : await this.workspaces.resolvedConfig(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        let command: string;
        if (value.action === 'install')
          command = `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get install -y docker.io ${vm.distro === 'ubuntu' ? 'docker-compose-v2' : 'docker-compose'}\nsystemctl enable --now docker\ndocker version\n`;
        else if ('id' in value)
          command = `docker ${value.action === 'remove' ? 'rm' : value.action} ${quote(value.id)}`;
        else if ('image' in value)
          command = `docker ${value.action === 'pull' ? 'pull' : 'image rm'} ${quote(value.image)}`;
        else {
          const operation =
            value.action === 'compose-up' ? 'up -d' : value.action === 'compose-down' ? 'down' : 'restart';
          const workspace = '_workspace' in project ? project._workspace : undefined;
          command = `cd ${quote(project.directory)}\nif docker compose version >/dev/null 2>&1; then docker compose -p ${quote(`sakura-${id.slice(0, 8)}-${workspace || 'default'}`)} -f ${quote(value.file)} ${operation}; else docker-compose -p ${quote(`sakura-${id.slice(0, 8)}-${workspace || 'default'}`)} -f ${quote(value.file)} ${operation}; fi`;
        }
        const values =
          'secrets' in project
            ? projectPrivateValues(project as Awaited<ReturnType<Workspaces['resolvedConfig']>>)
            : [];
        const output = privateLog(log, values);
        try {
          const result = await guestTask(
            this.machines,
            id,
            `set -eu\n${envPrefix(project.environment)}\n${command}`,
            signal,
            output.write,
          );
          if (result.code !== 0)
            throw new AppError(redactValues(result.stderr || `Docker 操作失败（${result.code}）`, values));
        } finally {
          output.flush();
        }
      },
      { title: `容器 · ${value.action}`, vmId: id },
    );
  }
  close() {
    return this.jobs.close();
  }
}
