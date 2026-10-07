/**
 * 模块职责：生成并维护实例或项目的编辑器 SSH 档案，项目连接需先完成对应账户配置。
 * Module purpose: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
 */
import type { IdeV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { mkdir, readFile, readdir, writeFile, rename, copyFile, lstat, rm } from 'node:fs/promises';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { DATA, vmDir } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectSchema } from './project-config.ts';

import { readStore, regularDirectory } from './local-store.ts';
import { ProjectSsh } from './project-ssh.ts';
import { secureSshPaths } from './ssh-files.ts';

/**
 * 入口 / Entry: sshPath.
 * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"'` 供上层消费（`ide.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ide.ts`; this entry produces `'"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"'` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
 * 处理：通过 `value.replaceAll().replaceAll().replaceAll`, `value.replaceAll().replaceAll`, `value.replaceAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.replaceAll().replaceAll().replaceAll`, `value.replaceAll().replaceAll`, `value.replaceAll`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `'"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"'`.
 * 副作用 / Effects: `value.replaceAll().replaceAll().replaceAll`; `value.replaceAll().replaceAll`; `value.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const sshPath = (value: string) =>
  '"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"';

/** Saved private settings apply to every generated editor entry, including sibling projects. */
/**
 * 入口 / Entry: hasPrivateProject.
 * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `false` 供上层消费（`ide.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ide.ts`; this entry produces `true` / `false` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
 * 处理：通过 `inline.filter`, `readdir().catch`, `readdir`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.filter`, `readdir().catch`, `readdir`, `vmDir`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!parsed.success || parsed.data.networkIsolation === 'private'`.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `true`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return true;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return true;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function hasPrivateProject(id: string) {
  try {
    const files = (
      await readdir(vmDir(id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })
    ).filter((name) => /^project(?:-[a-f0-9]{16})?\.json$/.test(name));
    for (const file of files) {
      const parsed = projectSchema.safeParse(await readStore(join(vmDir(id), file), () => null));
      if (!parsed.success || parsed.data.networkIsolation === 'private') return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * 入口 / Entry: projectSshConfig.
 * 功能：从当前输入或状态计算 `( `Host ${entry.hostKeyAlias}\n HostName 127.0.0.1\n User root\n` + ` Port ${entry.port}\n IdentityFile ${sshPath(entry.ident…`，供调用方后续验证或使用。
 * Purpose: Computes `( `Host ${entry.hostKeyAlias}\n HostName 127.0.0.1\n User root\n` + ` Port ${entry.port}\n IdentityFile ${sshPath(entry.ident…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: entry: { hostKeyAlias: string; port: number; identity: string; knownHosts: string; }
 * 输出 / Returns: `( `Host ${entry.hostKeyAlias}\n HostName 127.0.0.1\n User root\n` + ` Port ${entry.port}\n IdentityFile ${sshPath(entry.ident…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function projectSshConfig(entry: {
  hostKeyAlias: string;
  port: number;
  identity: string;
  knownHosts: string;
}) {
  return (
    `Host ${entry.hostKeyAlias}\n  HostName 127.0.0.1\n  User root\n` +
    `  Port ${entry.port}\n  IdentityFile ${sshPath(entry.identity)}\n  IdentitiesOnly yes\n` +
    `  HostKeyAlias ${entry.hostKeyAlias}\n  StrictHostKeyChecking yes\n` +
    `  UserKnownHostsFile ${sshPath(entry.knownHosts)}\n  ForwardAgent no\n  ProxyCommand none\n  ProxyJump none\n`
  );
}

/** Exports use the live IDE owner so a returned project bridge remains alive. */
/**
 * 入口 / Entry: editorConnectionProfile.
 * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `service.profile(id, signal, client)` 供上层消费（`ide.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ide.ts`; this entry produces `service.profile(id, signal, client)` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
 * 处理：通过 `signal.throwIfAborted`, `service.profile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `service.profile`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `service`.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; id: string; signal: AbortSignal optional; client: 'openssh' | 'jetbrains' default='openssh'; service: Pick<IdeV1, 'profile'> optional
 * 输出 / Returns: `service.profile(id, signal, client)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `new AppError('项目 SSH 档案需要启用 IDE 插件并先配置项目连接', 409)`.
 */
export async function editorConnectionProfile(
  machines: Machines,
  workspaces: WorkspacesV1,
  id: string,
  signal?: AbortSignal,
  client: 'openssh' | 'jetbrains' = 'openssh',
  service?: Pick<IdeV1, 'profile'>,
) {
  signal?.throwIfAborted();
  if (service) return service.profile(id, signal, client);
  throw new AppError('项目 SSH 档案需要启用 IDE 插件并先配置项目连接', 409);
}

export class Ide {
  private queue = Promise.resolve();
  private file = join(DATA, 'ssh', 'config');
  /**
   * 签名 / Signature: Ide.unsubscribeConfig.
   * 功能：为生成并维护实例或项目的编辑器 SSH 档案声明 unsubscribeConfig 的输入与结果契约，所属容器为 Ide。
   * Purpose: Declares the input/result contract for unsubscribeConfig in Ide. Module responsibility: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unsubscribeConfig: () => void;
  private projectSsh?: ProjectSsh;
  /**
   * 入口 / Entry: Ide.ssh.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(this.projectSsh ||= new ProjectSsh(this.machines, this.workspaces))` 供上层消费（`Ide`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Ide`; this entry produces `(this.projectSsh ||= new ProjectSsh(this.machines, this.workspaces))` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `(this.projectSsh ||= new ProjectSsh(this.machines, this.workspaces))`.
   * 副作用 / Effects: 更新 / updates `this.projectSsh`.
   */
  private ssh() {
    return (this.projectSsh ||= new ProjectSsh(this.machines, this.workspaces));
  }
  /**
   * 入口 / Entry: Ide.onChange.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Ide`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Ide`; the calls and state transitions below complete the operation. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.update().catch`, `this.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.update().catch`, `this.update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.update().catch`; `this.update`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    void this.update().catch(() => {});
  };
  /**
   * 入口 / Entry: Ide.constructor.
   * 功能：建立 Ide 的生成并维护实例或项目的编辑器 SSH 档案上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Ide context for this module's responsibility: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; sshDirectory: default=join(homedir(), '.ssh')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.unsubscribeConfig`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private sshDirectory = join(homedir(), '.ssh'),
  ) {
    machines.on('change', this.onChange);
    this.unsubscribeConfig = workspaces.onConfigChange?.(() => this.update()) || (() => {});
  }
  /**
   * 入口 / Entry: Ide.profile.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ alias: endpoint.hostKeyAlias, host: '127.0.0.1', port: endpoint.port, username: 'root', directory: project.directory, ident…` 供上层消费（`Ide`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Ide`; this entry produces `{ alias: endpoint.hostKeyAlias, host: '127.0.0.1', port: endpoint.port, username: 'root', directory: project.directory, ident…` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `signal.throwIfAborted`, `this.workspaces.config`, `inline.includes`, `this.machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.workspaces.config`, `inline.includes`, `this.machines.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional; client: 'openssh' | 'jetbrains' default='openssh'
   * 输出 / Returns: `{ alias: endpoint.hostKeyAlias, host: '127.0.0.1', port: endpoint.port, username: 'root', directory: project.directory, ident…`.
   * 副作用 / Effects: `writeFile`; `rename`; `rm`; 更新 / updates `knownHosts`.
   * 拒绝 / Refusals: 条件 / conditions `!['alpine', 'debian', 'ubuntu'].includes(this.machines.get(id).distro || '')`; `!endpoint`; `client === 'jetbrains'`; 异常 / errors `new AppError('项目 SSH 档案支持 Alpine、Debian 与 Ubuntu', 409)`; `new AppError('请先在项目页配置项目 SSH 连接', 409)`.
   * 收尾：退出 try 区域时始终执行 `await rm(temporary, { force: true });`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await rm(temporary, { force: true });`; these steps also apply to exceptional exits.
   */
  async profile(id: string, signal?: AbortSignal, client: 'openssh' | 'jetbrains' = 'openssh') {
    signal?.throwIfAborted();
    const project = await this.workspaces.config(id);
    if (!['alpine', 'debian', 'ubuntu'].includes(this.machines.get(id).distro || ''))
      throw new AppError('项目 SSH 档案支持 Alpine、Debian 与 Ubuntu', 409);
    const endpoint = await this.ssh().endpoint(id, project, signal);
    if (!endpoint) throw new AppError('请先在项目页配置项目 SSH 连接', 409);
    signal?.throwIfAborted();
    let knownHosts = endpoint.knownHosts;
    if (client === 'jetbrains') {
      // Gateway's SSHJ verifier does not honor OpenSSH HostKeyAlias. Bind its
      // actual loopback endpoint to the same verified project key, never TOFU.
      if (
        !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(endpoint.hostPublicKey) ||
        (await readFile(endpoint.knownHosts, 'utf8')) !==
          `${endpoint.hostKeyAlias} ${endpoint.hostPublicKey}\n`
      )
        throw new AppError('项目 SSH 主机公钥绑定已变化，请停止并重建连接', 409);
      const folder = await regularDirectory(dirname(endpoint.knownHosts));
      knownHosts = join(folder, 'known_hosts.jetbrains');
      const temporary = join(folder, '.known-hosts-jetbrains-' + randomUUID());
      try {
        await writeFile(
          temporary,
          `${endpoint.hostKeyAlias} ${endpoint.hostPublicKey}\n` +
            `[127.0.0.1]:${endpoint.port} ${endpoint.hostPublicKey}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        await secureSshPaths([temporary]);
        signal?.throwIfAborted();
        await rename(temporary, knownHosts);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return {
      alias: endpoint.hostKeyAlias,
      host: '127.0.0.1',
      port: endpoint.port,
      username: 'root',
      directory: project.directory,
      identityFile: endpoint.identity,
      knownHostsFile: knownHosts,
      hostKeyAlias: endpoint.hostKeyAlias,
      projectScoped: true,
      projectId: project._workspace || 'default',
      vscodeSupported: this.machines.get(id).distro !== 'alpine',
      networkIsolation: project.networkIsolation || 'host',
      config:
        projectSshConfig({ ...endpoint, knownHosts }) +
        (client === 'jetbrains'
          ? '  GlobalKnownHostsFile none\n  IdentityAgent none\n' +
            '  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n'
          : ''),
      ...(client === 'jetbrains' ? { hostKeyVerification: 'project-and-endpoint' as const } : {}),
    };
  }
  /**
   * 入口 / Entry: Ide.update.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，校验并提交领域状态变更；处理结果记录到 `this.queue`（`Ide`）。
   * Purpose: Validates and commits a domain state change in `Ide`; the outcome is recorded in `this.queue`. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async update() {
    /**
     * 入口 / Entry: Ide.update.callback@147.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.queue.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.queue.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `entries.push`; `mkdir`; `writeFile`; `rename`; `seen.add`; 更新 / updates `directory`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const entries: string[] = [];
        for (const entry of (await this.projectSsh?.entries()) || []) {
          entries.push(projectSshConfig(entry));
        }
        const text = entries.filter(Boolean).join('\n');
        await mkdir(join(DATA, 'ssh'), { recursive: true });
        await writeFile(this.file + '.tmp', text, { mode: 0o600 });
        await secureSshPaths([this.file + '.tmp']);
        await rename(this.file + '.tmp', this.file);
        // Existing user SSH Include directives may still point at an earlier data root.
        let directory = DATA;
        const seen = new Set<string>();
        for (let step = 0; step < 32; step++) {
          const marker = await readStore<{ source: string; id: string } | null>(
            join(directory, '.sakura-migration.json'),
            () => null,
          );
          if (!marker || !isAbsolute(marker.source) || seen.has(resolve(marker.source))) break;
          const redirect = await readStore<{ target: string; id: string } | null>(
            join(marker.source, '.sakura-redirect.json'),
            () => null,
          );
          if (!redirect || redirect.id !== marker.id || resolve(redirect.target) !== resolve(directory))
            break;
          seen.add(resolve(marker.source));
          const folder = await regularDirectory(join(marker.source, 'ssh'));
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, 'config.tmp'), `Include ${sshPath(this.file)}\n`, { mode: 0o600 });
          await secureSshPaths([join(folder, 'config.tmp')]);
          await rename(join(folder, 'config.tmp'), join(folder, 'config'));
          directory = marker.source;
        }
      });
    await this.queue;
  }
  /**
   * 入口 / Entry: Ide.view.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ supported: false, running: this.machines.state(id) === 'running', vscodeSupported: false, alias: '', config: this.file, com…` / `{ supported: true, vscodeSupported, running: this.machines.state(id) === 'running', projectScoped: true, projectId, networkIs…` 供上层消费（`Ide`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Ide`; this entry produces `{ supported: false, running: this.machines.state(id) === 'running', vscodeSupported: false, alias: '', config: this.file, com…` / `{ supported: true, vscodeSupported, running: this.machines.state(id) === 'running', projectScoped: true, projectId, networkIs…` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.machines.get`, `this.workspaces.config`, `inline.includes`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.workspaces.config`, `inline.includes`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!['alpine', 'debian', 'ubuntu'].includes(vm.distro || '')`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ supported: false, running: this.machines.state(id) === 'running', vscodeSupported: false, alias: '', config: this.file, com…`; `{ supported: true, vscodeSupported, running: this.machines.state(id) === 'running', projectScoped: true, projectId, networkIs…`.
   * 副作用 / Effects: `this.update`; `project.directory.replaceAll`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const vm = this.machines.get(id),
      project = await this.workspaces.config(id);
    const vscodeSupported = vm.distro === 'debian' || vm.distro === 'ubuntu';
    if (!['alpine', 'debian', 'ubuntu'].includes(vm.distro || ''))
      return {
        supported: false,
        running: this.machines.state(id) === 'running',
        vscodeSupported: false,
        alias: '',
        config: this.file,
        command: '',
        url: '',
      };
    {
      const projectId = project._workspace || 'default',
        alias = `sakura-${id}-${projectId}`;
      const runtime = await this.ssh().status(id, project);
      const endpoint = await this.ssh().endpoint(id, project);
      await this.update();
      return {
        supported: true,
        vscodeSupported,
        running: this.machines.state(id) === 'running',
        projectScoped: true,
        projectId,
        networkIsolation: project.networkIsolation || 'host',
        runtime,
        alias,
        config: this.file,
        command:
          endpoint && vscodeSupported
            ? `code --remote ssh-remote+${alias} '${project.directory.replaceAll("'", "''")}'`
            : '',
        sshCommand: endpoint ? `ssh ${alias}` : '',
        url:
          endpoint && vscodeSupported
            ? `vscode://vscode-remote/ssh-remote+${alias}${project.directory.split('/').map(encodeURIComponent).join('/')}`
            : '',
      };
    }
  }
  /**
   * 入口 / Entry: Ide.install.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked('ssh-config', async () => { await this.update(); const identity = join(vmDir(id), 'id_rsa'); if ( await …` 供上层消费（`Ide`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Ide`; this entry produces `this.machines.locked('ssh-config', async () => { await this.update(); const identity = join(vmDir(id), 'id_rsa'); if ( await …` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.view`, `this.ssh().start`, `this.ssh`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.view`, `this.ssh().start`, `this.ssh`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `'projectScoped' in view && view.projectScoped`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `this.machines.locked('ssh-config', async () => { await this.update(); const identity = join(vmDir(id), 'id_rsa'); if ( await …`.
   * 副作用 / Effects: `this.ssh().start`; 更新 / updates `view`.
   * 拒绝 / Refusals: 条件 / conditions `!view.supported`; `!view.running`; 异常 / errors `new AppError('项目 SSH 接入支持 Alpine、Debian 与 Ubuntu')`; `new AppError('请先启动发行版')`.
   */
  async install(id: string, signal?: AbortSignal) {
    let view = await this.view(id);
    if (!view.supported) throw new AppError('项目 SSH 接入支持 Alpine、Debian 与 Ubuntu');
    if (!view.running) throw new AppError('请先启动发行版');
    if ('projectScoped' in view && view.projectScoped) {
      await this.ssh().start(id, signal);
      view = await this.view(id);
    }
    /**
     * 入口 / Entry: Ide.install.callback@233.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / ssh-config）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / ssh-config).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `view`.
     * 副作用 / Effects: `this.update`; `mkdir`; `writeFile`; `rename`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.machines.locked('ssh-config', async () => {
      await this.update();
      const identity = join(vmDir(id), 'id_rsa');
      if (
        await lstat(identity).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        })
      )
        await secureSshPaths([identity]);
      await mkdir(this.sshDirectory, { recursive: true });
      const file = join(this.sshDirectory, 'config');
      const previous = await readFile(file, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      const include = `Include ${sshPath(this.file)}`;
      if (!previous.split(/\r?\n/).includes(include)) {
        if (previous) await copyFile(file, `${file}.sakura-backup-${Date.now()}`);
        await writeFile(file + '.sakura-tmp', include + '\n\n' + previous, { mode: 0o600 });
        await secureSshPaths([file + '.sakura-tmp']);
        await rename(file + '.sakura-tmp', file);
      }
      return view;
    });
  }
  /**
   * 入口 / Entry: Ide.close.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Ide`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Ide`; the calls and state transitions below complete the operation. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.machines.off`, `this.unsubscribeConfig`, `this.projectSsh.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.unsubscribeConfig`, `this.projectSsh.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.projectSsh.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.machines.off('change', this.onChange);
    this.unsubscribeConfig();
    await this.projectSsh?.close();
    await this.queue.catch(() => {});
  }
  /**
   * 入口 / Entry: Ide.stop.
   * 功能：在生成并维护实例或项目的编辑器 SSH 档案中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.view(id)` 供上层消费（`Ide`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Ide`; this entry produces `this.view(id)` for its caller. Module context: Maintains VM/project editor SSH profiles; project connections require their account connection to be configured first.
   * 处理：通过 `this.ssh().stop`, `this.ssh`, `this.update`, `this.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ssh().stop`, `this.ssh`, `this.update`, `this.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.view(id)`.
   * 副作用 / Effects: `this.ssh().stop`; `this.update`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string) {
    await this.ssh().stop(id);
    await this.update();
    return this.view(id);
  }
}
