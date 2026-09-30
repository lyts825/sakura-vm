import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import {
  devcontainerTemplates,
  devcontainerTemplateId,
  devcontainerTemplateReference,
  devcontainerTemplateApplyInput,
  verifyDevcontainerTemplateMetadata,
} from './devcontainer-templates.ts';
import {
  privateDockerBinding,
  privateDockerCommand,
  privateDockerPaths,
  privateDockerStatus,
  preparePrivateDocker,
  stopPrivateDocker,
  privateComposeValidator,
} from './private-docker.ts';
import type { Project } from './workspaces.ts';
import { projectIdSchema } from './project-catalog.ts';

const containerId = z.string().regex(/^[a-f0-9]{12,64}$/);
const imageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/);
export const containerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('install-devcontainer-cli') }).strict(),
  z.object({ action: z.literal('start-project-runtime') }).strict(),
  z.object({ action: z.literal('stop-project-runtime') }).strict(),
  z.object({ action: z.literal('devcontainer-up') }).strict(),
  z.object({ action: z.literal('dockerfile-up'), file: repositoryPath.default('Dockerfile') }).strict(),
  devcontainerTemplateApplyInput,
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
    const project = await this.workspaces.config(id),
      privateNetwork = project.networkIsolation === 'private';
    if (this.machines.state(id) !== 'running')
      return {
        supported: true,
        installed: false,
        available: false,
        privateNetwork,
        containers: [],
        images: [],
        volumes: [],
        files: [],
        job: this.jobs.view(id),
        error: '请先启动或恢复发行版',
      };
    const runtime = privateNetwork
      ? await privateDockerStatus(this.machines, id, project, signal)
      : undefined;
    if (runtime && !runtime.valid) {
      const tools = await this.machines.exec(
        id,
        'command -v docker >/dev/null && command -v dockerd >/dev/null',
        10_000,
        signal,
      );
      return {
        supported: true,
        installed: tools.code === 0,
        available: false,
        runtime,
        privateNetwork: true,
        error: runtime.reason || undefined,
        containers: [],
        images: [],
        volumes: [],
        files: [],
        devcontainer: await this.devcontainerView(id, project.directory, signal),
        templates: devcontainerTemplates,
        job: this.jobs.view(id),
      };
    }
    const result = await this.machines.exec(
      id,
      privateNetwork
        ? privateDockerCommand(project, "docker version --format '{{.Server.Version}}'", false)
        : "if command -v docker >/dev/null; then docker version --format '{{.Server.Version}}'; else exit 127; fi",
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
    const command = `set -e\ndocker ps -a --format '{{json .}}'\necho SAKURA_IMAGES\ndocker image ls --format '{{json .}}'\necho SAKURA_VOLUMES\ndocker volume ls --format '{{json .}}'\necho SAKURA_COMPOSE\nif docker compose version >/dev/null 2>&1; then docker compose version; elif command -v docker-compose >/dev/null; then docker-compose version --short; fi\necho SAKURA_FILES\n${['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].map((name) => `test ! -f ${quote(posix.join(project.directory, name))} || echo ${name}`).join('\n')}`;
    const data = await this.machines.exec(
      id,
      privateNetwork ? privateDockerCommand(project, command, false) : command,
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
      privateNetwork,
      runtime,
      version: result.stdout.trim(),
      compose: compose.trim(),
      containers: jsonLines(containers).map(({ Command: _command, ...item }) => item),
      images: jsonLines(images),
      volumes: jsonLines(volumes),
      files: files.trim().split('\n').filter(Boolean),
      devcontainer: await this.devcontainerView(id, project.directory, signal),
      templates: devcontainerTemplates,
      job: this.jobs.view(id),
    };
  }
  async templateMetadata(id: string, input: string, version?: string, signal?: AbortSignal) {
    this.supported(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const templateId = devcontainerTemplateId.parse(input);
    const reference = devcontainerTemplateReference(templateId, version);
    const environment = await this.workspaces.networkEnvironment(id);
    const result = await this.machines.exec(
      id,
      `set -eu\n${envPrefix(environment)}\n` +
        `command -v devcontainer >/dev/null || { echo '请先安装 Dev Container CLI' >&2; exit 1; }\n` +
        `devcontainer templates metadata ${quote(reference)}`,
      60000,
      signal,
    );
    if (result.code !== 0) throw new AppError(result.stderr || '无法读取模板源元数据', 502);
    return verifyDevcontainerTemplateMetadata(result.stdout, templateId, version);
  }
  private async devcontainerView(id: string, directory: string, signal?: AbortSignal) {
    const command =
      `set -eu\ncd ${quote(directory)}\n` +
      `for path in .devcontainer/devcontainer.json .devcontainer.json Dockerfile; do ` +
      `if [ -f "$path" ]; then printf '%s\\n' "$path"; fi; done\n` +
      `echo SAKURA_DEVCONTAINER_VERSION\n` +
      `if command -v devcontainer >/dev/null 2>&1; then devcontainer --version || echo unavailable; else echo unavailable; fi`;
    const result = await this.machines.exec(id, command, 10000, signal);
    if (result.code !== 0) return { cliInstalled: false, files: [], error: result.stderr };
    const [fileOutput = '', versionOutput = ''] = result.stdout.split(/SAKURA_DEVCONTAINER_VERSION\r?\n/);
    const files = fileOutput.trim().split(/\r?\n/).filter(Boolean);
    const version = versionOutput.trim().split(/\r?\n/).at(-1);
    return {
      cliInstalled: !!version && version !== 'unavailable',
      version: version === 'unavailable' ? undefined : version,
      files,
    };
  }
  async logs(id: string, target: string, signal?: AbortSignal) {
    this.supported(id);
    containerId.parse(target);
    const project = await this.workspaces.resolvedConfig(id);
    const privateNetwork = project.networkIsolation === 'private';
    if (privateNetwork) await this.assertPrivateRuntime(id, project, signal);
    const command = `docker logs --tail 200 ${quote(target)}`;
    const inspect = `docker inspect --format '{{json .Config}}' ${quote(target)}`;
    const metadata = await this.machines.exec(
      id,
      privateNetwork ? privateDockerCommand(project, inspect, false) : inspect,
      10_000,
      signal,
    );
    if (metadata.code !== 0) throw new AppError('无法核对容器日志中的私密配置');
    const config = JSON.parse(metadata.stdout) as { Env?: string[]; Cmd?: string[] };
    const privateValues = [...projectPrivateValues(project)];
    for (const item of config.Env || []) {
      const separator = item.indexOf('=');
      if (
        separator > 0 &&
        (Object.hasOwn(project.secrets || {}, item.slice(0, separator)) ||
          /(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY)$/i.test(item.slice(0, separator)))
      )
        privateValues.push(item.slice(separator + 1));
    }
    for (const [index, arg] of (config.Cmd || []).entries()) {
      if (arg === '--requirepass' && config.Cmd?.[index + 1]) privateValues.push(config.Cmd[index + 1]);
      if (arg.startsWith('--requirepass=')) privateValues.push(arg.slice('--requirepass='.length));
    }
    const result = await this.machines.exec(
      id,
      privateNetwork ? privateDockerCommand(project, command, false) : command,
      10000,
      signal,
    );
    if (result.code !== 0) throw new AppError('无法读取容器日志');
    return {
      log: redactValues((result.stdout + result.stderr).slice(-32768), privateValues),
    };
  }
  async run(id: string, input: unknown) {
    const vm = this.supported(id),
      value = containerActionSchema.parse(input);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id));
    const preparation = ['install', 'install-devcontainer-cli', 'template-apply'].includes(value.action);
    return this.jobs.start(
      id,
      (log, signal) =>
        this.workspaces.projects.inScope(id, projectId, () =>
          this.machines.locked(id, async () => {
            signal.throwIfAborted();
            if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复发行版', 409);
            const saved = await this.workspaces.config(id),
              privateNetwork = saved.networkIsolation === 'private';
            const cleanup = [
              'start-project-runtime',
              'stop-project-runtime',
              'stop',
              'remove',
              'remove-image',
            ].includes(value.action);
            const project = preparation
              ? {
                  ...saved,
                  _workspace: saved._workspace,
                  environment: await this.workspaces.networkEnvironment(id),
                  secrets: undefined,
                }
              : cleanup
                ? saved
                : await this.workspaces.resolvedConfig(id);
            if (value.action === 'start-project-runtime' || value.action === 'stop-project-runtime') {
              if (!privateNetwork) throw new AppError('此项目使用共享 Docker，不需要独立启动环境', 409);
              if (value.action === 'start-project-runtime')
                await preparePrivateDocker(this.machines, id, project, signal);
              else await stopPrivateDocker(this.machines, id, project);
              log(
                value.action === 'start-project-runtime'
                  ? '项目私有 Docker 环境已启动。\n'
                  : '项目私有 Docker 环境已停止，容器与数据保留。\n',
              );
              return;
            }
            if (privateNetwork && !preparation && !['stop', 'remove', 'remove-image'].includes(value.action))
              await this.assertPrivateRuntime(id, project, signal);
            if (privateNetwork && value.action === 'pull') {
              await this.prefetchImage(id, project, value.image, signal, log);
              return;
            }
            const attempt = randomUUID();
            let command: string;
            if (value.action === 'install')
              command = `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get install -y docker.io python3 python3-yaml iproute2 ${vm.distro === 'ubuntu' ? 'docker-compose-v2' : 'docker-compose'}\nsystemctl enable --now docker\ndocker version\n`;
            else if (value.action === 'install-devcontainer-cli')
              command = `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get install -y nodejs npm python3 make g++\nnode --version\nnpm --version\nnpm install --global @devcontainers/cli@0.82.0\ndevcontainer --version`;
            else if (value.action === 'devcontainer-up')
              command =
                `set -eu\ncd ${quote(project.directory)}\n` +
                `if [ ! -f .devcontainer/devcontainer.json ] && [ ! -f .devcontainer.json ]; then ` +
                `echo '项目没有 devcontainer.json' >&2; exit 1; fi\n` +
                `command -v devcontainer >/dev/null || { echo '请先安装 Dev Container CLI' >&2; exit 1; }\n` +
                `docker version >/dev/null\n` +
                `devcontainer up --workspace-folder ${quote(project.directory)}${
                  privateNetwork
                    ? ` --buildkit never --docker-path ${quote(privateDockerPaths(projectId).config + '/docker-client')} --docker-compose-path ${quote(privateDockerPaths(projectId).config + '/compose-client')}` +
                      ` --id-label ${quote('sakura.vm=' + id)} --id-label ${quote('sakura.project=' + projectId)}` +
                      ` --id-label ${quote('sakura.binding=' + privateDockerBinding(project))} --id-label ${quote('sakura.attempt=' + attempt)}`
                    : ''
                }`;
            else if (value.action === 'template-apply') {
              log(`读取官方模板 ${value.templateId}:${value.version} 元数据并检查来源…\n`);
              const metadata = await this.templateMetadata(id, value.templateId, value.version, signal);
              const variant = value.imageVariant || metadata.imageVariant?.default;
              if (metadata.imageVariant && (!variant || !metadata.imageVariant.choices.includes(variant)))
                throw new AppError('模板镜像版本不在发布者提供的选项中', 409);
              if (!metadata.imageVariant && value.imageVariant)
                throw new AppError('该模板不接受镜像版本参数', 409);
              if (value.omitPaths.some((path) => !metadata.optionalPaths.includes(path)))
                throw new AppError('只能省略模板声明为可选的文件', 409);
              const args = variant ? { imageVariant: variant } : {};
              command =
                `set -eu\nroot=$(realpath -e -- ${quote(project.directory)})\n` +
                `if [ -n "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then ` +
                `echo '模板只能应用到空项目目录' >&2; exit 1; fi\n` +
                `parent=$(dirname -- "$root")\n` +
                `staged=$(mktemp -d -p "$parent" .sakura-devtemplate-XXXXXXXX)\n` +
                `trap 'case "$staged" in "$parent"/.sakura-devtemplate-*) ` +
                `if [ -d "$staged" ]; then rm -r -- "$staged"; fi;; esac' EXIT\n` +
                `devcontainer templates apply --template-id ${quote(metadata.reference)} ` +
                `--workspace-folder "$staged" --template-args ${quote(JSON.stringify(args))} ` +
                `--omit-paths ${quote(JSON.stringify(value.omitPaths))}\n` +
                `test -f "$staged/.devcontainer/devcontainer.json"\n` +
                `python3 - "$staged" "$root" <<'PY'\n` +
                `import os, sys\n` +
                `source, target = sys.argv[1:]\n` +
                `if not os.path.isdir(source) or os.path.islink(source):\n` +
                `    raise SystemExit('模板暂存目录无效')\n` +
                `if not os.path.isdir(target) or os.path.islink(target):\n` +
                `    raise SystemExit('项目目录已变更')\n` +
                `with os.scandir(target) as entries:\n` +
                `    if next(entries, None) is not None:\n` +
                `        raise SystemExit('项目目录不再为空')\n` +
                `os.replace(source, target)\n` +
                `PY`;
            } else if (value.action === 'dockerfile-up') {
              const file = value.file;
              const workspace = '_workspace' in project ? project._workspace || 'default' : 'default';
              const name = `sakura-dev-${id.slice(0, 8)}-${workspace}`;
              const image = `${name}:latest`;
              if (/[,:]/.test(project.directory))
                throw new AppError('Dockerfile 模式暂不支持包含逗号或冒号的项目路径', 409);
              command =
                `set -eu\n` +
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
                `docker build ${privateNetwork ? '--network host ' : ''}-f "$dockerfile" -t ${quote(image)} "$root" && ` +
                `docker run -d --name ${quote(name)} --label sakura.managed=devcontainer ` +
                `--label ${quote(`sakura.vm=${id}`)} --label ${quote(`sakura.project=${workspace}`)} ` +
                `--label "sakura.directory=$root" ` +
                (privateNetwork
                  ? `--network host --restart no --label ${quote('sakura.binding=' + privateDockerBinding(project))} --label ${quote('sakura.attempt=' + attempt)} `
                  : '') +
                (privateNetwork
                  ? Object.keys(project.environment || {})
                      .map((key) => `--env ${quote(key)} `)
                      .join('')
                  : '') +
                `--mount "type=bind,source=$root,target=/workspace" ` +
                `-w /workspace --entrypoint /bin/sh ${quote(image)} -c 'while :; do sleep 600; done'; fi`;
            } else if ('id' in value)
              command = `docker ${value.action === 'remove' ? 'rm' : value.action} ${quote(value.id)}`;
            else if ('image' in value)
              command = `docker ${value.action === 'pull' ? 'pull' : 'image rm'} ${quote(value.image)}`;
            else {
              const operation =
                value.action === 'compose-up'
                  ? 'up -d'
                  : value.action === 'compose-down'
                    ? 'down'
                    : 'restart';
              const workspace = '_workspace' in project ? project._workspace : undefined;
              command = privateNetwork
                ? privateComposeScript(id, project, value.file, operation, attempt)
                : `cd ${quote(project.directory)}\nif docker compose version >/dev/null 2>&1; then docker compose -p ${quote(`sakura-${id.slice(0, 8)}-${workspace || 'default'}`)} -f ${quote(value.file)} ${operation}; else docker-compose -p ${quote(`sakura-${id.slice(0, 8)}-${workspace || 'default'}`)} -f ${quote(value.file)} ${operation}; fi`;
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
                privateNetwork && !preparation
                  ? ['stop', 'remove', 'remove-image'].includes(value.action)
                    ? `env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/sh -ec ${quote(`${privateDockerPaths(projectId).config}/docker-client ${'id' in value ? (value.action === 'remove' ? 'rm' : value.action) + ' ' + quote(value.id) : 'image rm ' + quote('image' in value ? value.image : '')}`)}`
                    : privateDockerCommand(
                        project,
                        `export SAKURA_CONTAINER_ATTEMPT=${quote(attempt)}\n${command}`,
                      )
                  : `set -eu\n${envPrefix(project.environment)}\n${command}`,
                signal,
                output.write,
              );
              if (result.code !== 0)
                throw new AppError(
                  redactValues(result.stderr || `Docker 操作失败（${result.code}）`, values),
                );
              if (privateNetwork && value.action === 'install')
                await preparePrivateDocker(this.machines, id, saved, signal);
              if (
                privateNetwork &&
                !preparation &&
                !['stop', 'remove', 'remove-image'].includes(value.action)
              )
                await this.assertPrivateRuntime(id, project, signal);
            } catch (error) {
              if (
                privateNetwork &&
                ['dockerfile-up', 'compose-up', 'devcontainer-up'].includes(value.action)
              ) {
                const p = privateDockerPaths(projectId);
                const cleanup = await this.machines.exec(
                  id,
                  `set -eu\nids=$(${p.config}/docker-client ps -aq --filter ${quote('label=sakura.attempt=' + attempt)})\n` +
                    `if [ -n "$ids" ]; then ${p.config}/docker-client rm -f $ids; fi`,
                  30_000,
                );
                if (cleanup.code !== 0)
                  throw new AppError('容器操作未完成且清理失败，请停止项目 Docker 环境', 409);
              }
              throw new AppError(redactValues((error as Error).message, values));
            } finally {
              output.flush();
            }
          }),
        ),
      { title: `容器 · ${value.action}`, vmId: id, projectId },
    );
  }
  close() {
    return this.jobs.close();
  }
  private async assertPrivateRuntime(id: string, project: Project, signal?: AbortSignal) {
    const status = await privateDockerStatus(this.machines, id, project, signal);
    if (!status.valid) throw new AppError(status.reason || '请先启动此项目的私有 Docker 环境', 409);
    return status;
  }
  async privateDatabase(
    id: string,
    input: { database: 'postgres' | 'mysql' | 'redis'; password: string; name?: string; port?: number },
    signal: AbortSignal,
    log: (text: string) => void,
  ) {
    this.supported(id);
    const value = z
      .object({
        database: z.enum(['postgres', 'mysql', 'redis']),
        password: z
          .string()
          .min(12)
          .max(128)
          .regex(/^[\x21-\x7e]+$/),
        name: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,31}$/)
          .optional(),
        port: z.number().int().min(1024).max(65535).optional(),
      })
      .strict()
      .parse(input);
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id));
    return this.workspaces.projects.inScope(id, projectId, () =>
      this.machines.locked(id, async () => {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
        const project = await this.workspaces.resolvedConfig(id);
        if (project.networkIsolation !== 'private')
          throw new AppError('项目网络已变化，请重新执行数据库操作', 409);
        await preparePrivateDocker(this.machines, id, project, signal);
        const image =
          value.database === 'postgres'
            ? 'postgres:16-alpine'
            : value.database === 'mysql'
              ? 'mysql:8'
              : 'redis:7-alpine';
        const secretValues = [value.password, ...projectPrivateValues(project)],
          output = privateLog(log, secretValues);
        const attempt = randomUUID(),
          p = privateDockerPaths(projectId),
          name = value.name || `sakura-${value.database}`;
        try {
          await this.prefetchImage(id, project, image, signal, output.write);
          const port =
            value.port || (value.database === 'postgres' ? 5432 : value.database === 'mysql' ? 3306 : 6379);
          const environment =
            value.database === 'postgres'
              ? { POSTGRES_USER: 'sakura', POSTGRES_DB: 'sakura', POSTGRES_PASSWORD: value.password }
              : value.database === 'mysql'
                ? {
                    MYSQL_DATABASE: 'sakura',
                    MYSQL_USER: 'sakura',
                    MYSQL_PASSWORD: value.password,
                    MYSQL_ROOT_PASSWORD: value.password,
                  }
                : {};
          const volume =
            value.database === 'postgres'
              ? '/var/lib/postgresql/data'
              : value.database === 'mysql'
                ? '/var/lib/mysql'
                : '/data';
          const args =
            value.database === 'postgres'
              ? ['postgres', '-p', String(port), '-c', 'listen_addresses=127.0.0.1']
              : value.database === 'mysql'
                ? ['--port=' + port, '--bind-address=127.0.0.1']
                : [
                    'redis-server',
                    '--bind',
                    '127.0.0.1',
                    '--port',
                    String(port),
                    '--appendonly',
                    'yes',
                    '--requirepass',
                    value.password,
                  ];
          const probe =
            value.database === 'postgres'
              ? `--env ${quote('PGPASSWORD=' + value.password)} ${quote(name)} psql -h 127.0.0.1 -p ${port} -U sakura -d sakura -tAc 'SELECT 1'`
              : value.database === 'mysql'
                ? `--env ${quote('MYSQL_PWD=' + value.password)} ${quote(name)} mysql -h 127.0.0.1 -P ${port} -u sakura sakura --batch --skip-column-names -e 'SELECT 1'`
                : `--env ${quote('REDISCLI_AUTH=' + value.password)} ${quote(name)} redis-cli -h 127.0.0.1 -p ${port} --raw PING`;
          const expected = value.database === 'redis' ? 'PONG' : '1';
          const portCheck = `import socket\ns=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\ntry: s.bind(('127.0.0.1',${port}))\nexcept OSError: raise SystemExit('项目数据库端口已被使用')\nfinally: s.close()`;
          const command =
            `set -eu\nif docker container inspect ${quote(name)} >/dev/null 2>&1; then echo '同名数据库容器已存在' >&2; exit 1; fi\n` +
            `python3 -I -S -c ${quote(portCheck)}\n` +
            `docker run -d --restart no --network host --name ${quote(name)} --label sakura.managed=database ` +
            `--label ${quote('sakura.vm=' + id)} --label ${quote('sakura.project=' + projectId)} --label ${quote('sakura.attempt=' + attempt)} ` +
            `--label ${quote('sakura.binding=' + privateDockerBinding(project))} --volume ${quote(name + '-data:' + volume)} ` +
            `${Object.entries(environment)
              .map(([key, item]) => '--env ' + quote(key + '=' + item))
              .join(' ')} ${quote(image)} ${args.map(quote).join(' ')}\n` +
            `ready=0\nfor sakura_attempt in $(seq 1 90); do\n` +
            `if [ "$(docker inspect --format '{{.State.Running}}' ${quote(name)})" != true ]; then docker logs --tail 50 ${quote(name)} >&2; echo '数据库容器已退出' >&2; exit 1; fi\n` +
            `if [ "$(docker exec ${probe} 2>/dev/null)" = ${quote(expected)} ]; then ready=1; break; fi\nsleep 2\ndone\n` +
            `[ "$ready" = 1 ] || { echo '数据库认证或初始化未就绪，请核对密码及保留的数据卷' >&2; exit 1; }\n` +
            `printf '%s\\n' ${quote(`${name} 已启动 · 项目 127.0.0.1:${port} · 数据卷 ${name}-data`)}`;
          const result = await guestTask(
            this.machines,
            id,
            privateDockerCommand(project, command),
            signal,
            output.write,
          );
          if (result.code !== 0) throw new AppError(result.stderr || '数据库容器启动失败', 409);
          await this.assertPrivateRuntime(id, project, signal);
        } catch (error) {
          const cleanup = await this.machines.exec(
            id,
            `ids=$(${p.config}/docker-client ps -aq --filter ${quote('label=sakura.attempt=' + attempt)})\n` +
              `if [ -n "$ids" ]; then ${p.config}/docker-client rm -f $ids; fi`,
            30_000,
          );
          if (cleanup.code !== 0)
            throw new AppError('数据库启动未完成且清理失败，请停止项目 Docker 环境', 409);
          throw new AppError(redactValues((error as Error).message, secretValues));
        } finally {
          output.flush();
        }
      }),
    );
  }
  private async prefetchImage(
    id: string,
    project: Project,
    image: string,
    signal: AbortSignal,
    log: (text: string) => void,
  ) {
    const environment = await this.workspaces.networkEnvironment(id),
      p = privateDockerPaths(project._workspace || 'default');
    const script =
      `set -eu\n${envPrefix(environment)}\n` +
      `unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_HOST DOCKER_CONFIG\n` +
      `docker --host unix:///var/run/docker.sock image inspect ${quote(image)} >/dev/null 2>&1 || docker --host unix:///var/run/docker.sock pull ${quote(image)}\n` +
      `umask 077\narchive=$(mktemp /tmp/.sakura-image-XXXXXXXX.tar)\ntrap 'rm -f -- "$archive"' EXIT\ntrap 'exit 143' TERM HUP INT\n` +
      `docker --host unix:///var/run/docker.sock save -o "$archive" ${quote(image)}\n` +
      `${p.config}/docker-client load -i "$archive"`;
    const result = await guestTask(this.machines, id, script, signal, log);
    if (result.code !== 0) throw new AppError(result.stderr || '镜像预取或私有导入失败', 409);
    await this.assertPrivateRuntime(id, project, signal);
  }
}

function privateComposeScript(
  id: string,
  project: Project,
  file: string,
  operation: string,
  attempt: string,
) {
  const name = `sakura-${id.slice(0, 8)}-${project._workspace || 'default'}`;
  const validate =
    `import json,os,sys,yaml\n` +
    privateComposeValidator(project, { 'sakura.vm': id, 'sakura.attempt': attempt }) +
    `json.dump(private_compose(yaml.safe_load(open(sys.argv[1]))),open(sys.argv[2],'w'))\n`;
  return (
    `set -eu\numask 077\nroot=$(realpath -e -- ${quote(project.directory)})\nfile=$(realpath -e -- ${quote(posix.join(project.directory, file))})\n` +
    `case "$file" in "$root"/*) ;; *) echo 'Compose 文件超出项目目录' >&2; exit 1;; esac\n` +
    `config=''\nrender=$(mktemp /tmp/.sakura-compose-XXXXXXXX.yaml)\ntrap 'rm -f -- "$render" "$config"' EXIT\ntrap 'exit 143' TERM HUP INT\nconfig=$(mktemp /tmp/.sakura-compose-XXXXXXXX.json)\n` +
    `if docker compose version >/dev/null 2>&1; then sakura_compose=2; docker compose -p ${quote(name)} -f "$file" config > "$render"; ` +
    `else sakura_compose=1; /usr/bin/docker-compose -p ${quote(name)} -f "$file" config > "$render"; fi\n` +
    `python3 -I -c ${quote(validate)} "$render" "$config"\n` +
    `if [ "$sakura_compose" = 2 ]; then docker compose -p ${quote(name)} -f "$config" ${operation}; ` +
    `else /usr/bin/docker-compose -p ${quote(name)} -f "$config" ${operation}; fi`
  );
}
