import { mkdir, readFile, readdir, writeFile, rename, copyFile } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { DATA, vmDir, AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectSchema, type Workspaces } from './workspaces.ts';
import { readStore, regularDirectory } from './local-store.ts';

export const sshPath = (value: string) =>
  '"' + value.replaceAll('\\', '/').replaceAll('%', '%%').replaceAll('"', '\\"') + '"';
export class Ide {
  private queue = Promise.resolve();
  private file = join(DATA, 'ssh', 'config');
  private unsubscribeConfig: () => void;
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
  }
  private async hasPrivateProject(id: string) {
    try {
      const files = (await readdir(vmDir(id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      }))
        .filter((name) => /^project(?:-[a-f0-9]{16})?\.json$/.test(name));
      for (const file of files) {
        const parsed = projectSchema.safeParse(await readStore(
          join(vmDir(id), file), () => null));
        // An unreadable project config must not leave a previously generated alias active.
        if (!parsed.success || parsed.data.networkIsolation === 'private') return true;
      }
      return false;
    } catch { return true; }
  }
  async update() {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const entries = await Promise.all([...this.machines.records.values()].map(async (vm) => {
          if (await this.hasPrivateProject(vm.id)) return '';
          return `Host sakura-${vm.name}\n  HostName 127.0.0.1\n  User root\n  Port ${this.machines.live.get(vm.id)?.sshPort || 1}\n  IdentityFile ${sshPath(join(vmDir(vm.id), 'id_rsa'))}\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile ${sshPath(join(vmDir(vm.id), 'known_hosts'))}\n`;
        }));
        const text = entries.filter(Boolean).join('\n');
        await mkdir(join(DATA, 'ssh'), { recursive: true });
        await writeFile(this.file + '.tmp', text, { mode: 0o600 });
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
    if (project.networkIsolation === 'private' || await this.hasPrivateProject(id))
      return { supported: false, running: this.machines.state(id) === 'running',
        alias, config: this.file, command: '', url: '', reason: 'private-network' as const };
    return {
      supported: !!vm.distro && vm.distro !== 'alpine',
      running: this.machines.state(id) === 'running',
      alias,
      config: this.file,
      command: `code --remote ssh-remote+${alias} '${project.directory.replaceAll("'", "''")}'`,
      url: `vscode://vscode-remote/ssh-remote+${alias}${project.directory.split('/').map(encodeURIComponent).join('/')}`,
    };
  }
  async install(id: string) {
    const view = await this.view(id);
    if (!view.supported) throw new AppError(view.reason === 'private-network'
      ? '实例包含私有项目，不能通过共享网络的 Remote-SSH 运行编辑器；请使用项目终端和文件编辑器。'
      : 'VS Code Remote-SSH 请使用 Debian 或 Ubuntu');
    if (!view.running) throw new AppError('请先启动发行版');
    return this.machines.locked('ssh-config', async () => {
      await this.update();
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
        await rename(file + '.sakura-tmp', file);
      }
      return view;
    });
  }
  async close() {
    this.machines.off('change', this.onChange);
    this.unsubscribeConfig();
    await this.queue.catch(() => {});
  }
}
