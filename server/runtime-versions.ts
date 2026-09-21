import { posix } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces, Project } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { quote } from './files.ts';
import { guestTask } from './guest-task.ts';
import { envPrefix } from './project-services.ts';

export const exactVersion = z.string().regex(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
export const runtimesSchema = z
  .object({ node: exactVersion.optional(), python: exactVersion.optional() })
  .strict();
export type RuntimeVersionsConfig = z.infer<typeof runtimesSchema>;
export const runtimeRoot = '/opt/sakura-runtimes';
export function runtimeBin(tool: 'node' | 'python', version: string) {
  exactVersion.parse(version);
  return `${runtimeRoot}/${tool}-${version}/bin`;
}
export function runtimeEnvironment(
  versions?: RuntimeVersionsConfig,
  existingPath?: string,
): Record<string, string> {
  const paths = (Object.entries(versions || {}) as ['node' | 'python', string][]).map(([tool, version]) =>
    runtimeBin(tool, version),
  );
  return paths.length
    ? {
        PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(
          ':',
        ),
        ...(versions?.python ? { VIRTUAL_ENV: `${runtimeRoot}/python-${versions.python}` } : {}),
      }
    : {};
}
export function declarationVersion(text: string) {
  const value = text.trim().split(/\r?\n/)[0]?.trim().replace(/^v/, '');
  return /^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null;
}
export function matchesVersion(actual: string, requested: string) {
  return actual === requested || actual.startsWith(requested + '.');
}
export class RuntimeVersions {
  jobs = new Jobs('runtime-versions');
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  async inspect(id: string, project: Project, signal?: AbortSignal) {
    const environment = runtimeEnvironment(project.runtimes, project.environment?.PATH);
    const result = await this.machines.exec(
      id,
      `${envPrefix(environment)}\nnode --version 2>/dev/null || true\necho SAKURA_PYTHON\npython3 --version 2>/dev/null || true`,
      10000,
      signal,
    );
    const [node, python] = result.stdout.split('SAKURA_PYTHON\n');
    return {
      node: node?.trim().replace(/^v/, '') || '',
      python: python?.trim().replace(/^Python /, '') || '',
    };
  }
  async view(id: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id),
      selected = project.runtimes || {};
    const declared: Partial<Record<'node' | 'python', string>> = {};
    for (const [tool, file] of [
      ['node', '.nvmrc'],
      ['node', '.node-version'],
      ['python', '.python-version'],
    ] as const) {
      if (declared[tool]) continue;
      try {
        const version = declarationVersion(
          await this.machines.readGuestFile(id, posix.join(project.directory, file)),
        );
        if (version) declared[tool] = version;
      } catch (error) {
        if (!/不存在|not found|No such|普通文件/i.test((error as Error).message)) throw error;
      }
    }
    const actual = await this.inspect(id, project, signal);
    return {
      selected,
      declared,
      actual,
      mismatches: (['node', 'python'] as const).filter(
        (tool) =>
          (selected[tool] || declared[tool]) &&
          !matchesVersion(actual[tool], selected[tool] || declared[tool]!),
      ),
      job: this.jobs.view(this.workspaces.projects.key(id)),
    };
  }
  async select(id: string, input: unknown) {
    const runtimes = runtimesSchema.parse(input),
      project = await this.workspaces.config(id);
    for (const [tool, version] of Object.entries(runtimes) as ['node' | 'python', string][]) {
      const executable = `${runtimeBin(tool, version)}/${tool === 'python' ? 'python3' : 'node'}`;
      const result = await this.machines.exec(id, `${quote(executable)} --version`, 10000);
      if (result.code !== 0 || !result.stdout.includes(version))
        throw new AppError(`请先安装 ${tool} ${version}`);
    }
    return this.workspaces.save(id, { ...project, runtimes });
  }
  async install(id: string, input: unknown) {
    const { tool, version } = z
      .object({ tool: z.enum(['node', 'python']), version: exactVersion })
      .strict()
      .parse(input);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (tool === 'node' && (!vm.distro || vm.distro === 'alpine'))
      throw new AppError('Node 官方预编译版本需要 Debian/Ubuntu；Alpine 可继续使用发行版 Node');
    const environment = await this.workspaces.networkEnvironment(id),
      destination = `${runtimeRoot}/${tool}-${version}`;
    return this.jobs.start(
      this.workspaces.projects.key(id),
      async (log, signal) => {
        const setup =
          !vm.distro || vm.distro === 'alpine'
            ? 'apk add --no-cache --timeout 30 python3 py3-pip py3-virtualenv curl ca-certificates tar xz'
            : 'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get -y install python3 python3-venv curl ca-certificates tar xz-utils';
        const install =
          tool === 'node'
            ? `archive=node-v${version}-linux-x64.tar.xz\ncd "$stage"\ncurl --fail --location --retry 2 --connect-timeout 20 --max-time 600 -O https://nodejs.org/dist/v${version}/$archive\ncurl --fail --location --retry 2 --connect-timeout 20 --max-time 60 -O https://nodejs.org/dist/v${version}/SHASUMS256.txt\ngrep "  $archive$" SHASUMS256.txt > checksum\n[ "$(wc -l < checksum)" -eq 1 ]\nsha256sum -c checksum\nmkdir runtime\ntar -xJf "$archive" -C runtime --strip-components=1\n./runtime/bin/node --version | grep -Fx v${version}\nmv runtime ${quote(destination)}`
            : `python3 -m venv "$stage/uv"\n"$stage/uv/bin/python" -m pip install --disable-pip-version-check uv==0.10.11\nexport UV_PYTHON_INSTALL_DIR=${quote(runtimeRoot + '/python-downloads')}\n"$stage/uv/bin/uv" python install ${version}\n"$stage/uv/bin/uv" venv --python ${version} --seed ${quote(destination)}\n${quote(destination + '/bin/python3')} --version | grep -Fx ${quote('Python ' + version)}`;
        const script = `set -eu\n${envPrefix(environment)}\n${setup}\nmkdir -p ${quote(runtimeRoot)}\nif [ -d ${quote(destination)} ]; then ${quote(destination + '/bin/' + (tool === 'node' ? 'node' : 'python3'))} --version; exit 0; fi\nstage=$(mktemp -d ${quote(runtimeRoot + '/.install-XXXXXX')})\ntrap 'rm -rf "$stage"' EXIT\n${install}\necho '版本已安装，请在项目中选择启用'`;
        const result = await guestTask(this.machines, id, script, signal, log);
        if (result.code !== 0) throw new AppError('版本安装失败，请查看日志');
      },
      {
        title: `安装 ${tool} ${version}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `install:${tool}:${version}`,
      },
    );
  }
  close() {
    return this.jobs.close();
  }
}
