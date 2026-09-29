import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { envPrefix } from './project-services.ts';
import { quote } from './files.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';

export const toolCatalog = {
  git: {
    name: 'Git',
    executable: 'git',
    version: 'git --version',
    alpine: 'git',
    apt: 'git',
    markers: ['.git'],
  },
  node: {
    name: 'Node.js / npm',
    executable: 'node',
    version: 'node --version; npm --version',
    alpine: 'nodejs npm',
    apt: 'nodejs npm',
    markers: ['package.json'],
  },
  python: {
    name: 'Python / pip',
    executable: 'python3',
    version: 'python3 --version; python3 -m pip --version',
    alpine: 'python3 py3-pip',
    apt: 'python3 python3-pip python3-venv',
    markers: ['pyproject.toml', 'requirements.txt'],
  },
  rust: {
    name: 'Rust / Cargo',
    executable: 'cargo',
    version: 'rustc --version; cargo --version',
    alpine: 'rust cargo build-base',
    apt: 'rustc cargo build-essential',
    markers: ['Cargo.toml'],
  },
  go: {
    name: 'Go',
    executable: 'go',
    version: 'go version',
    alpine: 'go',
    apt: 'golang-go',
    markers: ['go.mod'],
  },
  java: {
    name: 'Java JDK',
    executable: 'javac',
    version: 'java -version; javac -version',
    alpine: 'openjdk17-jdk',
    apt: 'default-jdk',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  },
  php: {
    name: 'PHP',
    executable: 'php',
    version: 'php --version',
    alpine: 'php84 php84-phar php84-openssl',
    apt: 'php-cli php-mbstring php-xml',
    markers: ['composer.json'],
  },
} as const;
export type ToolId = keyof typeof toolCatalog;
export class Toolchains {
  jobs = new Jobs('toolchains');
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  async view(id: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    const script = Object.entries(toolCatalog)
      .map(
        ([key, tool]) =>
          `printf '\\nSAKURA_TOOL_${key}\\n'; if command -v ${tool.executable} >/dev/null; then ${tool.version} 2>&1 | head -c 2000; fi; printf '\\nSAKURA_REQUIRED_${key}\\n'; ${tool.markers.map((file) => `test ! -e ${quote(project.directory + '/' + file)} || printf yes`).join('; ')}; printf '\\n'`,
      )
      .join('\n');
    const result = await this.machines.exec(id,
      project.networkIsolation === 'private' ? projectNetworkCommand(project, script) : script,
      20000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '无法检查开发工具');
    return {
      tools: Object.entries(toolCatalog).map(([key, tool]) => {
        const part = result.stdout.split(`SAKURA_TOOL_${key}\n`)[1]?.split('\nSAKURA_TOOL_')[0] || '';
        const [version, required] = part.split(`\nSAKURA_REQUIRED_${key}\n`);
        return {
          id: key,
          name: tool.name,
          installed: !!version.trim(),
          version: version.trim(),
          required: required?.includes('yes') || false,
        };
      }),
      job: this.jobs.view(id),
    };
  }
  async install(id: string, input: unknown) {
    const { tools } = z
      .object({
        tools: z
          .array(z.enum(['git', 'node', 'python', 'rust', 'go', 'java', 'php']))
          .min(1)
          .max(7),
      })
      .strict()
      .parse(input);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    const environment = await this.workspaces.networkEnvironment(id);
    const packages = [...new Set(tools)]
      .map((key) => toolCatalog[key][!vm.distro || vm.distro === 'alpine' ? 'alpine' : 'apt'])
      .join(' ');
    return this.jobs.start(
      id,
      async (log, signal) => {
        const script =
          !vm.distro || vm.distro === 'alpine'
            ? `apk add --no-cache --timeout 30 ${packages}`
            : `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\napt-get -y install ${packages}`;
        const result = await guestTask(
          this.machines,
          id,
          `set -eu\n${envPrefix(environment)}\n${script}`,
          signal,
          log,
        );
        if (result.code !== 0) throw new AppError('开发工具安装失败，请查看任务日志');
      },
      { title: `安装开发工具 · ${tools.join(', ')}`, vmId: id },
    );
  }
  close() {
    return this.jobs.close();
  }
}
