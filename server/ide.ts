import { mkdir, readFile, readdir, writeFile, rename, copyFile, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { DATA, vmDir, AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectSchema, type Workspaces } from './workspaces.ts';
import { readStore, regularDirectory } from './local-store.ts';
import { ProjectSsh } from './project-ssh.ts';
import { secureSshPaths } from './ssh-files.ts';

export const sshPath = (value: string) =>
  '"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"';
const activeIde = new WeakMap<Workspaces, Ide>();

/** Saved private settings apply to every generated editor entry, including sibling projects. */
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

function projectSshConfig(entry: {
  hostKeyAlias: string; port: number; identity: string; knownHosts: string;
}) {
  return `Host ${entry.hostKeyAlias}\n  HostName 127.0.0.1\n  User root\n` +
    `  Port ${entry.port}\n  IdentityFile ${sshPath(entry.identity)}\n  IdentitiesOnly yes\n` +
    `  HostKeyAlias ${entry.hostKeyAlias}\n  StrictHostKeyChecking yes\n` +
    `  UserKnownHostsFile ${sshPath(entry.knownHosts)}\n  ForwardAgent no\n  ProxyCommand none\n  ProxyJump none\n`;
}

function legacyProfile(machines: Machines, id: string, directory: string) {
  const vm = machines.get(id), live = machines.live.get(id);
  if (!live || machines.state(id) !== 'running')
    throw new AppError('请先启动实例，以获取当前 SSH 端口', 409);
  const alias = 'sakura-' + vm.name, identityFile = join(vmDir(id), 'id_rsa'),
    knownHostsFile = join(vmDir(id), 'known_hosts');
  return {
    alias, host: '127.0.0.1', port: live.sshPort, username: 'root', directory,
    identityFile, knownHostsFile, projectScoped: false,
    config: `Host ${alias}\n  HostName 127.0.0.1\n  Port ${live.sshPort}\n  User root\n` +
      `  IdentityFile ${sshPath(identityFile)}\n  IdentitiesOnly yes\n` +
      `  StrictHostKeyChecking accept-new\n  UserKnownHostsFile ${sshPath(knownHostsFile)}\n`,
  };
}

/** Exports use the live IDE owner so a returned project bridge remains alive. */
export async function editorConnectionProfile(machines: Machines, workspaces: Workspaces,
  id: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const service = activeIde.get(workspaces);
  if (service) return service.profile(id, signal);
  const project = await workspaces.config(id);
  if (project.networkIsolation === 'private' || await hasPrivateProject(id))
    throw new AppError('项目 SSH 档案需要启用 IDE 插件并先配置项目连接', 409);
  signal?.throwIfAborted();
  return legacyProfile(machines, id, project.directory);
}

export class Ide {
  private queue = Promise.resolve();
  private file = join(DATA, 'ssh', 'config');
  private unsubscribeConfig: () => void;
  private projectSsh?: ProjectSsh;
  private ssh() {
    return (this.projectSsh ||= new ProjectSsh(this.machines, this.workspaces));
  }
  private onChange = () => {
    void this.update().catch(() => {});
  };
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private sshDirectory = join(homedir(), '.ssh'),
  ) {
    machines.on('change', this.onChange);
    this.unsubscribeConfig = workspaces.onConfigChange?.(() => this.update()) || (() => {});
    activeIde.set(workspaces, this);
  }
  async profile(id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const project = await this.workspaces.config(id);
    if (project.networkIsolation !== 'private' && !await hasPrivateProject(id))
      return legacyProfile(this.machines, id, project.directory);
    if (!['debian', 'ubuntu'].includes(this.machines.get(id).distro || ''))
      throw new AppError('项目 SSH 档案支持 Debian 与 Ubuntu', 409);
    const endpoint = await this.ssh().endpoint(id, project, signal);
    if (!endpoint) throw new AppError('请先在项目页配置项目 SSH 连接', 409);
    signal?.throwIfAborted();
    return {
      alias: endpoint.hostKeyAlias, host: '127.0.0.1', port: endpoint.port,
      username: 'root', directory: project.directory, identityFile: endpoint.identity,
      knownHostsFile: endpoint.knownHosts, hostKeyAlias: endpoint.hostKeyAlias,
      projectScoped: true, projectId: project._workspace || 'default',
      networkIsolation: project.networkIsolation || 'host', config: projectSshConfig(endpoint),
    };
  }
  async update() {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const entries = await Promise.all(
          [...this.machines.records.values()].map(async (vm) => {
            if (await hasPrivateProject(vm.id)) return '';
            return `Host sakura-${vm.name}\n  HostName 127.0.0.1\n  User root\n  Port ${this.machines.live.get(vm.id)?.sshPort || 1}\n  IdentityFile ${sshPath(join(vmDir(vm.id), 'id_rsa'))}\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile ${sshPath(join(vmDir(vm.id), 'known_hosts'))}\n`;
          }),
        );
        for (const entry of (await this.projectSsh?.entries()) || []) {
          // VM IDs exceed the 32-character VM name limit, so these aliases
          // cannot collide with another VM's legacy name-based profile.
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
  async view(id: string) {
    const vm = this.machines.get(id),
      project = await this.workspaces.config(id);
    const alias = `sakura-${vm.name}`;
    const scoped = project.networkIsolation === 'private' || (await hasPrivateProject(id));
    if (scoped && !['debian', 'ubuntu'].includes(vm.distro || ''))
      return { supported: false, running: this.machines.state(id) === 'running',
        alias: '', config: this.file, command: '', url: '' };
    if (scoped) {
      const projectId = project._workspace || 'default',
        alias = `sakura-${id}-${projectId}`;
      const runtime = await this.ssh().status(id, project);
      const endpoint = await this.ssh().endpoint(id, project);
      await this.update();
      return {
        supported: true,
        running: this.machines.state(id) === 'running',
        projectScoped: true,
        projectId,
        networkIsolation: project.networkIsolation || 'host',
        runtime,
        alias,
        config: this.file,
        command: endpoint
          ? `code --remote ssh-remote+${alias} '${project.directory.replaceAll("'", "''")}'`
          : '',
        sshCommand: endpoint ? `ssh ${alias}` : '',
        url: endpoint
          ? `vscode://vscode-remote/ssh-remote+${alias}${project.directory.split('/').map(encodeURIComponent).join('/')}`
          : '',
      };
    }
    return {
      supported: !!vm.distro && vm.distro !== 'alpine',
      running: this.machines.state(id) === 'running',
      alias,
      config: this.file,
      command: `code --remote ssh-remote+${alias} '${project.directory.replaceAll("'", "''")}'`,
      url: `vscode://vscode-remote/ssh-remote+${alias}${project.directory.split('/').map(encodeURIComponent).join('/')}`,
    };
  }
  async install(id: string, signal?: AbortSignal) {
    let view = await this.view(id);
    if (!view.supported) throw new AppError('VS Code Remote-SSH 请使用 Debian 或 Ubuntu');
    if (!view.running) throw new AppError('请先启动发行版');
    if ('projectScoped' in view && view.projectScoped) {
      await this.ssh().start(id, signal);
      view = await this.view(id);
    }
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
  async close() {
    if (activeIde.get(this.workspaces) === this) activeIde.delete(this.workspaces);
    this.machines.off('change', this.onChange);
    this.unsubscribeConfig();
    await this.projectSsh?.close();
    await this.queue.catch(() => {});
  }
  async stop(id: string) {
    await this.ssh().stop(id);
    await this.update();
    return this.view(id);
  }
}
