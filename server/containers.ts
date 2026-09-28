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
  z.object({ action: z.literal('install-devcontainer-cli') }).strict(),
  z.object({ action: z.literal('devcontainer-up') }).strict(),
  z.object({ action: z.literal('dockerfile-up'), file: repositoryPath.default('Dockerfile') }).strict(),
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
      devcontainer: await this.devcontainerView(id, project.directory, signal),
      job: this.jobs.view(id),
    };
  }
  private async devcontainerView(id: string, directory: string, signal?: AbortSignal) {
    const command = `set -eu\ncd ${quote(directory)}\n` +
      `for path in .devcontainer/devcontainer.json .devcontainer.json Dockerfile; do ` +
      `if [ -f "$path" ]; then printf '%s\\n' "$path"; fi; done\n` +
      `echo SAKURA_DEVCONTAINER_VERSION\n` +
      `if command -v devcontainer >/dev/null 2>&1; then devcontainer --version || echo unavailable; else echo unavailable; fi`;
    const result = await this.machines.exec(id, command, 10000, signal);
    if (result.code !== 0) return { cliInstalled: false, files: [], error: result.stderr };
    const [fileOutput = '', versionOutput = ''] = result.stdout.split(/SAKURA_DEVCONTAINER_VERSION\r?\n/);
    const files = fileOutput.trim().split(/\r?\n/).filter(Boolean);
    const version = versionOutput.trim().split(/\r?\n/).at(-1);
    return { cliInstalled: !!version && version !== 'unavailable',
      version: version === 'unavailable' ? undefined : version,
      files };
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
      value.action === 'install' || value.action === 'install-devcontainer-cli'
        ? { directory: '/workspace', environment: await this.workspaces.networkEnvironment(id) }
        : await this.workspaces.resolvedConfig(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        let command: string;
        if (value.action === 'install')
          command = `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get install -y docker.io ${vm.distro === 'ubuntu' ? 'docker-compose-v2' : 'docker-compose'}\nsystemctl enable --now docker\ndocker version\n`;
        else if (value.action === 'install-devcontainer-cli')
          command = `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get install -y nodejs npm python3 make g++\nnpm install --global @devcontainers/cli@0.82.0\ndevcontainer --version`;
        else if (value.action === 'devcontainer-up')
          command = `set -eu\ncd ${quote(project.directory)}\n` +
            `if [ ! -f .devcontainer/devcontainer.json ] && [ ! -f .devcontainer.json ]; then ` +
            `echo '项目没有 devcontainer.json' >&2; exit 1; fi\n` +
            `command -v devcontainer >/dev/null || { echo '请先安装 Dev Container CLI' >&2; exit 1; }\n` +
            `docker version >/dev/null\n` +
            `devcontainer up --workspace-folder ${quote(project.directory)}`;
        else if (value.action === 'dockerfile-up') {
          const file = value.file;
          const workspace = '_workspace' in project ? project._workspace || 'default' : 'default';
          const name = `sakura-dev-${id.slice(0, 8)}-${workspace}`;
          const image = `${name}:latest`;
          if (/[,:]/.test(project.directory))
            throw new AppError('Dockerfile 模式暂不支持包含逗号或冒号的项目路径', 409);
          command = `set -eu\n` +
            `root=$(realpath -e -- ${quote(project.directory)})\n` +
            `case "$root" in *','*|*':'*) echo '项目路径不适合 Docker bind mount' >&2; exit 1;; esac\n` +
            `dockerfile=$(realpath -e -- ${quote(posix.join(project.directory, file))})\n` +
            `case "$dockerfile" in "$root"/*) ;; *) echo 'Dockerfile 超出项目目录' >&2; exit 1;; esac\n` +
            `if docker container inspect ${quote(name)} >/dev/null 2>&1; then ` +
            `owner=$(docker inspect --format '{{index .Config.Labels "sakura.vm"}}' ${quote(name)}); ` +
            `[ "$owner" = ${quote(id)} ] || { echo '同名容器不属于此实例' >&2; exit 1; }; ` +
            `mounted=$(docker inspect --format '{{index .Config.Labels "sakura.directory"}}' ${quote(name)}); ` +
            `[ "$mounted" = "$root" ] || { echo '项目目录已变更，请删除旧容器后重建' >&2; exit 1; }; ` +
            `docker start ${quote(name)}; else ` +
            `docker build -f "$dockerfile" -t ${quote(image)} "$root" && ` +
            `docker run -d --name ${quote(name)} --label sakura.managed=devcontainer ` +
            `--label ${quote(`sakura.vm=${id}`)} --label ${quote(`sakura.project=${workspace}`)} ` +
            `--label "sakura.directory=$root" ` +
            `--mount "type=bind,source=$root,target=/workspace" ` +
            `-w /workspace --entrypoint /bin/sh ${quote(image)} -c 'while :; do sleep 600; done'; fi`;
        }
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
