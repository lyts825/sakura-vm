import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, projectVersion, type Project, type Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { envPrefix } from './project-services.ts';
import { quote } from './files.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues, privateLog } from './secrets.ts';

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
export type ToolchainsOptions = {
  createPreparation?: () => Pick<ProjectTerminals, 'prepare' | 'close'>;
  runTask?: typeof projectIdentityTask;
  runInstallTask?: typeof guestTask;
};
function capturedProject(project: Project, projectId: string) {
  const captured = structuredClone(project);
  Object.defineProperty(captured, '_workspace', {
    value: projectId === 'default' ? undefined : projectId, enumerable: false,
  });
  return captured;
}
const changed = () => new AppError('工具探测原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
function redactError(error: unknown, values: string[]) {
  if (!(error instanceof Error)) return error;
  const message = redactValues(error.message, values);
  // AbortSignal's default DOMException has a getter-only message. Never replace
  // an unchanged cancellation/cleanup error or let redaction mask its identity.
  if (message === error.message) return error;
  try {
    Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true });
    return error;
  } catch {
    const wrapped = new AppError(message, error instanceof AppError ? error.status : 500,
      error instanceof AppError ? error.code : undefined);
    wrapped.name = error.name; Object.defineProperty(wrapped, 'cause', { value: error });
    return wrapped;
  }
}
class ToolchainCleanupErrors extends AppError {
  readonly cause: unknown;
  constructor(readonly errors: unknown[], cause: unknown) {
    const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
    super(critical?.message || '工具探测准备清理未确认，请核查原运行记录', 503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED');
    this.cause = cause;
  }
}

// Package installation is instance administration. Only the administrator's
// applied network proxies enter its environment; never project PATH/config.
function installEnvironment(value: Record<string, string>) {
  const environment: Record<string, string> = {};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
    const content = value[key];
    if (content === undefined) continue;
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 16384 ||
        Buffer.from(content).toString('utf8') !== content)
      throw new AppError('管理员安装网络环境超过受保护输入边界', 413, 'GUEST_INPUT_INVALID');
    environment[key] = content;
  }
  return environment;
}
const installCommand = 'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ USER=root LOGNAME=root ' +
  'LANG=C LC_ALL=C /bin/sh -eu -s';

export class Toolchains {
  jobs = new Jobs('toolchains');
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private options: ToolchainsOptions = {},
  ) {}
  async view(id: string, signal?: AbortSignal) {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const active = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    active.throwIfAborted();
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    const operation = this.workspaces.projects.inScope(id, projectId, () => this.probe(id, projectId, live, active));
    this.pending.add(operation);
    try { return await operation; } finally { this.pending.delete(operation); }
  }
  private async probe(id: string, projectId: string, live: NonNullable<ReturnType<Machines['live']['get']>>, signal: AbortSignal) {
    const origin = () => {
      signal.throwIfAborted();
      if (this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live ||
          this.machines.state(id) !== 'running') throw changed();
    };
    origin();
    const original = await this.workspaces.config(id);
    origin();
    if ((original._workspace || 'default') !== projectId) throw changed();
    const project = capturedProject(original, projectId), version = projectVersion(project);
    let active = signal, privateValues = projectPrivateValues(project);
    const assertCurrent = async () => {
      origin(); active.throwIfAborted();
      const current = await this.workspaces.config(id);
      origin(); active.throwIfAborted();
      if ((current._workspace || 'default') !== projectId || projectVersion(current) !== version ||
          projectVersion(project) !== version) throw changed();
    };
    await assertCurrent();
    const preparation = this.options.createPreparation?.() || new ProjectTerminals(this.machines, this.workspaces);
    let lease: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let failed = false, failure: unknown;
    try {
      lease = await preparation.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: preparedSignal } = lease;
      if (!captured || !preparedSignal || lease.projectId !== projectId || captured.live !== live ||
          (captured.project._workspace || 'default') !== projectId || captured.configVersion !== version ||
          projectVersion(captured.project) !== version) throw changed();
      active = AbortSignal.any([signal, preparedSignal]);
      await assertCurrent();
      const resolved = await this.workspaces.resolveProject(id, capturedProject(project, projectId));
      privateValues = projectPrivateValues(resolved);
      await assertCurrent();
      if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
          (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')) throw changed();
      // Native launch fchdir'ed its pinned original directory descriptor. All
      // version binaries and marker lookups execute only after UID/GID drop.
      const script = Object.entries(toolCatalog)
        .map(
          ([key, tool]) =>
            `printf '\\nSAKURA_TOOL_${key}\\n'; if command -v ${tool.executable} >/dev/null; then ${tool.version} 2>&1 | head -c 2000; fi; printf '\\nSAKURA_REQUIRED_${key}\\n'; ${tool.markers.map((file) => `test ! -e ${quote(file)} || printf yes`).join('; ')}; printf '\\n'`,
        )
        .join('\n');
      const execution = { command: script, environment: resolved.environment };
      try { projectIdentityPayload(execution); }
      catch { throw new AppError('工具探测命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
      const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project, execution,
        active, undefined, 20000, undefined, undefined, { expectedLive: live });
      await assertCurrent();
      if (!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
        throw new AppError('工具探测任务响应缺少原退出码或输出', 502, 'TOOLCHAIN_TASK_RESULT_INVALID');
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2)
        throw new AppError('工具探测输出超过 1 MiB', 413, 'TOOLCHAIN_OUTPUT_TOO_LARGE');
      if (result.code !== 0) throw new AppError(redactValues(result.stderr || '无法检查开发工具', privateValues));
      return {
        tools: Object.entries(toolCatalog).map(([key, tool]) => {
          const part = result.stdout.split(`SAKURA_TOOL_${key}\n`)[1]?.split('\nSAKURA_TOOL_')[0] || '';
          const [version, required] = part.split(`\nSAKURA_REQUIRED_${key}\n`);
          return {
            id: key,
            name: tool.name,
            installed: !!version.trim(),
            version: redactValues(version.trim(), privateValues),
            required: required?.includes('yes') || false,
          };
        }),
        job: this.jobs.view(id),
      };
    } catch (error) {
      failed = true; failure = redactError(error, privateValues);
      throw failure;
    } finally {
      // The task transport owns full-domain retirement. Keep the preparation
      // guard until its awaited execution and cleanup settle, including errors.
      const errors: unknown[] = [];
      try { await lease?.release(); } catch (error) { errors.push(error); }
      try { await preparation.close(); } catch (error) { errors.push(error); }
      if (errors.length) {
        if (failed) errors.unshift(failure);
        const critical = errors.find((error) => error instanceof AppError && error.status === 503);
        const error = errors.length === 1 && critical ? critical :
          new ToolchainCleanupErrors(errors, critical || failure || errors[0]);
        throw redactError(error, privateValues);
      }
    }
  }
  async install(id: string, input: unknown) {
    this.controller.signal.throwIfAborted();
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
    const live = this.machines.live.get(id), distro = vm.distro || 'alpine';
    const assertOrigin = () => {
      this.controller.signal.throwIfAborted();
      if (!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
        throw new AppError('管理员安装原客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    };
    assertOrigin();
    const environment = installEnvironment(await this.workspaces.networkEnvironment(id));
    assertOrigin();
    const packages = [...new Set(tools)]
      .map((key) => toolCatalog[key][distro === 'alpine' ? 'alpine' : 'apt'])
      .join(' ');
    const script = distro === 'alpine' ? `/sbin/apk add --no-cache --timeout 30 ${packages} </dev/null` :
      `export DEBIAN_FRONTEND=noninteractive\n/usr/bin/apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update </dev/null\n/usr/bin/apt-get -y install ${packages} </dev/null`;
    const body = Buffer.from(`set -eu\ncd /\n${envPrefix(environment)}\n${script}\n`);
    if (body.length > 128 * 1024) throw new AppError('管理员安装正文超过受保护输入边界', 413, 'GUEST_INPUT_INVALID');
    return this.jobs.start(
      id,
      async (log, signal) => {
        assertOrigin(); signal.throwIfAborted();
        const redacted = privateLog(log, Object.values(environment));
        try {
          const result = await (this.options.runInstallTask || guestTask)(this.machines, id, installCommand,
            signal, redacted.write, undefined, undefined, undefined, { input: body });
          assertOrigin(); signal.throwIfAborted();
          if (result.code !== 0) throw new AppError('开发工具安装失败，请查看任务日志');
        } catch (error) {
          throw redactError(error, Object.values(environment));
        } finally { redacted.flush(); }
      },
      { title: `安装开发工具 · ${tools.join(', ')}`, vmId: id },
    );
  }
  close() {
    if (this.closing) return this.closing;
    this.controller.abort();
    this.closing = (async () => {
      const results = await Promise.allSettled([this.jobs.close(), ...this.pending]);
      const errors = results.flatMap((result, index) => result.status === 'rejected' &&
        (index === 0 || result.reason instanceof AppError && result.reason.status === 503) ? [result.reason] : []);
      if (errors.length) throw errors.length === 1 ? errors[0] : new ToolchainCleanupErrors(errors, errors[0]);
    })();
    return this.closing;
  }
}
