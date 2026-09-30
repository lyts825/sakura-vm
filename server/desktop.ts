import { createWebSocketStream, WebSocket } from 'ws';
import type { ClientChannel } from 'ssh2';
import type { Machines } from './machines.ts';
import { AppError, type DesktopView } from './model.ts';
import {
  defaultDesktopPreferences,
  desktopPreferencesSchema,
  parseDesktopPreferencesFile,
  type DesktopPreferences,
} from './desktop-preferences.ts';
import { desktopCommands } from './desktop-guest.ts';
import { ReadOnlyRfb } from './readonly-rfb.ts';
import { SingleAppWindows } from './single-app-windows.ts';
import { projectPrivateValues, type Workspaces } from './workspaces.ts';
import { DesktopBindings, bindingProject, desktopBindingCheck, desktopServiceStop,
  type DesktopBinding } from './desktop-binding.ts';
import { projectNetworkCommand, projectNetworkNamespace, projectNetworkCheckScript } from './project-network-isolation.ts';
import { privateLog, redactValues } from './secrets.ts';
import { guestTask } from './guest-task.ts';
import { uidCleanupScript } from './single-app-sandbox.ts';
import { X11Clipboard } from './x11-clipboard.ts';

type Operation = {
  startedAt: string;
  abort: AbortController;
  view: DesktopView;
  privateValues?: string[];
  done?: Promise<void>;
};

export class Desktops {
  readonly apps: SingleAppWindows;
  readonly clipboard: X11Clipboard;
  private operations = new Map<string, Operation>();
  private pending = new Set<Promise<void>>();
  private closed = false;
  private bindings: DesktopBindings;
  private unguard?: () => void;
  private watchers = new Map<string, { startedAt: string; listeners: Set<() => void> }>();
  private recovery = new Map<string, string>();
  private installed = new Set<string>();
  constructor(private machines: Machines, private workspaces?: Workspaces) {
    this.apps = new SingleAppWindows(machines, workspaces);
    this.bindings = new DesktopBindings(machines);
    this.clipboard = new X11Clipboard(machines, async (id) => {
      if (!this.workspaces) throw new AppError('请先启用项目工作区', 409);
      await this.desktopCommand(id, this.workspaces.projects.current(id));
      const binding = await this.bindings.read(id);
      if (!binding) throw new AppError('请停止并重新启动桌面以登记项目绑定', 409);
      const project = await this.workspaces.resolvedConfig(id);
      return { project, launcherSha256: binding.launcherSha256 };
    });
    machines.on('change', this.onChange);
    machines.on('incident-lockdown', this.invalidate);
    this.unguard = workspaces?.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory &&
          (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      const binding = await this.bindings.read(id);
      if ((binding?.projectId || 'default') !== (previous._workspace || 'default')) return;
      if (this.machines.state(id) === 'paused')
        throw new AppError('请先恢复实例并停止桌面，再修改项目目录或网络模式', 409);
      if (this.machines.state(id) !== 'running') {
        if (binding?.enabled) await this.bindings.enable(id, binding, false);
        return;
      }
      const phase = await this.servicePhase(id);
      if (['ready', 'starting'].includes(phase))
        throw new AppError('请先停止此项目的 KDE 桌面，再修改目录或网络模式', 409);
      if (phase === 'stopped') await this.stopService(id);
    });
    if (workspaces) queueMicrotask(() => { if (!this.closed) this.onChange(); });
  }
  private invalidate = (id: string) => {
    const watchers = this.watchers.get(id);
    this.watchers.delete(id);
    for (const listener of watchers?.listeners || []) listener();
  };
  private onChange = () => {
    for (const [id, operation] of this.operations) {
      const live = this.machines.live.get(id);
      if (live?.status !== 'running' || live.startedAt !== operation.startedAt) {
        operation.abort.abort();
        this.operations.delete(id);
      }
    }
    for (const [id, watchers] of this.watchers) {
      const live = this.machines.live.get(id);
      if (live?.status !== 'running' || live.startedAt !== watchers.startedAt) this.invalidate(id);
    }
    for (const [id, live] of this.machines.live) {
      if (live.status !== 'running' || this.recovery.get(id) === live.startedAt) continue;
      this.recovery.set(id, live.startedAt);
      const recovered = this.restore(id).catch((error: Error) => {
        if (!this.closed && this.machines.live.get(id) === live && !this.operations.has(id))
          this.operations.set(id, { startedAt: live.startedAt, abort: new AbortController(),
            view: { status: 'error', log: '', error: `桌面自动恢复失败：${error.message}`,
              preferences: defaultDesktopPreferences } });
      });
      this.pending.add(recovered);
      void recovered.finally(() => this.pending.delete(recovered));
    }
  };

  private async restore(id: string) {
    if (this.closed || this.operations.has(id)) return;
    if (!this.workspaces) {
      if (this.installed.has(id)) this.start(id, 'start');
      return;
    }
    const binding = await this.bindings.read(id);
    if (!binding?.enabled || this.closed || this.operations.has(id)) return;
    await this.workspaces.projects.with(id, binding.projectId, async () => {
      const project = await this.workspaces!.config(id);
      if (project.directory !== binding.directory || (project.networkIsolation || 'host') !== binding.networkIsolation) {
        await this.bindings.enable(id, binding, false);
        return;
      }
      if (this.closed || this.machines.state(id) !== 'running') return;
      if (['ready', 'starting'].includes(await this.servicePhase(id))) {
        await this.bindingValid(id, binding);
        return;
      }
      this.start(id, 'start');
    });
  }
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    this.machines.off('incident-lockdown', this.invalidate);
    for (const id of this.watchers.keys()) this.invalidate(id);
    for (const operation of this.operations.values()) operation.abort.abort();
    await Promise.allSettled([this.apps.close(), this.clipboard.close(), ...this.pending]);
    this.operations.clear();
    this.recovery.clear();
    this.unguard?.();
  }

  private async servicePhase(id: string) {
    const binding = this.workspaces ? await this.bindings.read(id) : null;
    const result = await this.machines.exec(id, desktopCommands(this.machines.get(id).distro,
      defaultDesktopPreferences, binding ? bindingProject(binding) : undefined).probe, 10000);
    const phase = result.stdout.trim();
    if (result.code !== 0 || !['not-installed', 'starting', 'ready', 'stopped'].includes(phase))
      throw new AppError('无法检查桌面状态，请重试', 502);
    return phase as DesktopView['status'];
  }

  private async stopService(id: string) {
    this.invalidate(id);
    let corrupted = false;
    const binding = this.workspaces ? await this.bindings.read(id).catch(() => { corrupted = true; return null; }) : null;
    if (binding?.enabled) await this.bindings.enable(id, binding, false);
    const result = await this.machines.exec(id, `set -eu\n${desktopServiceStop(this.machines.get(id).distro)}\n` +
      `if id sakura-desktop >/dev/null 2>&1; then\n` +
      `export SAKURA_DESKTOP_UID="$(id -u sakura-desktop)"\n` +
      `${uidCleanupScript(1000, 'SAKURA_DESKTOP_UID')}\nfi`, 30000);
    if (result.code !== 0) throw new AppError('无法停止 KDE 桌面及自动启动服务', 409);
    if (corrupted) await this.bindings.clear(id);
  }

  async stop(id: string) {
    const operation = this.operations.get(id);
    operation?.abort.abort();
    await operation?.done;
    return this.machines.locked(id, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先恢复或启动实例，再停止桌面', 409);
      await this.stopService(id);
      this.operations.delete(id);
      return { stopped: true };
    });
  }

  private metadata(binding: DesktopBinding) {
    return { projectId: binding.projectId, directory: binding.directory, networkIsolation: binding.networkIsolation };
  }

  private async bindingValid(id: string, binding: DesktopBinding) {
    const result = await this.machines.exec(id, `set -eu\n${desktopBindingCheck(binding)}\n` +
      (projectNetworkNamespace(bindingProject(binding)) ? projectNetworkCheckScript(projectNetworkNamespace(bindingProject(binding))!) : '') +
      `\nexpected=$(${projectNetworkCommand(bindingProject(binding), 'readlink /proc/self/ns/net')})\n` +
      `for pid in $(pgrep -u sakura-desktop); do\n` +
      `actual=$(readlink /proc/"$pid"/ns/net) || continue\n` +
      `test "$actual" = "$expected" || { echo '桌面进程网络空间不符' >&2; exit 1; }\ndone`, 10000);
    if (result.code !== 0) throw new AppError('桌面项目绑定或实际网络空间不符，请停止并重新启动桌面', 409);
  }

  async view(id: string, bound = false): Promise<DesktopView> {
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { status: 'unavailable', log: '', preferences: defaultDesktopPreferences };
    const operation = this.operations.get(id);
    if (operation) return { ...operation.view, ...(this.workspaces && !bound ? {
      bindingMismatch: operation.view.projectId !== this.workspaces.projects.current(id) } : {}) };
    const binding = this.workspaces ? await this.bindings.read(id) : null;
    const commands = desktopCommands(vm.distro, defaultDesktopPreferences, binding ? bindingProject(binding) : undefined);
    const result = await this.machines.exec(id, commands.probe, 10000);
    const status = result.stdout.trim();
    if (result.code !== 0 || !['not-installed', 'starting', 'ready', 'stopped'].includes(status))
      throw new AppError('无法检查桌面状态，请重试', 502);
    let preferences = defaultDesktopPreferences;
    try {
      const config = await this.machines.exec(id, commands.preferencesProbe, 10000);
      if (config.code === 0) preferences = parseDesktopPreferencesFile(config.stdout);
    } catch {
      // A status check remains useful when an older desktop has no preferences file.
    }
    if (binding && status === 'ready') await this.bindingValid(id, binding);
    let bindingMismatch = false;
    if (this.workspaces && !bound) {
      const project = await this.workspaces.config(id);
      bindingMismatch = ['ready', 'starting'].includes(status) && (binding ? binding.projectId !== (project._workspace || 'default') ||
        binding.directory !== project.directory || binding.networkIsolation !== (project.networkIsolation || 'host') :
        (project._workspace || 'default') !== 'default' || project.networkIsolation === 'private');
    }
    return { status: status as DesktopView['status'], log: '', preferences,
      ...(binding ? this.metadata(binding) : {}), ...(bindingMismatch ? { bindingMismatch } : {}) };
  }

  start(
    id: string,
    action: 'install' | 'start' | 'configure',
    input?: Partial<DesktopPreferences>,
  ): DesktopView {
    const vm = this.machines.get(id);
    const live = this.machines.live.get(id);
    if (this.closed || this.machines.closing || live?.status !== 'running')
      throw new AppError('请等待发行版启动完成，再启用桌面', 409);
    const previous = this.operations.get(id);
    if (previous && ['installing', 'starting'].includes(previous.view.status)) {
      if (this.workspaces && previous.view.projectId !== this.workspaces.projects.current(id))
        throw new AppError('另一项目的桌面操作正在进行', 409);
      return { ...previous.view };
    }
    if (vm.memoryMiB < 1024)
      throw new AppError('图形桌面至少需要 1024 MiB 内存；请停机后在「配置」中调整，建议 2048 MiB', 409);
    const preferences = desktopPreferencesSchema.parse(input || {});
    const commands = desktopCommands(vm.distro, preferences);
    const status = action === 'install' ? 'installing' : 'starting';
    const operation: Operation = {
      startedAt: live.startedAt,
      abort: new AbortController(),
      view: {
        status,
        preferences,
        ...(this.workspaces ? { projectId: this.workspaces.projects.current(id) } : {}),
        log:
          action === 'install'
            ? '正在准备 KDE Plasma 桌面安装…\n'
            : action === 'configure'
              ? '正在应用 KDE Plasma 外观配置…\n'
              : '正在启动 KDE Plasma 桌面…\n',
      },
    };
    this.operations.set(id, operation);
    const execute = () => this.machines.exec(
        id,
        action === 'install'
          ? commands.install
          : action === 'configure'
            ? commands.configure
            : input === undefined
              ? commands.start
              : commands.startWithPreferences,
        action === 'install' ? 920000 : action === 'configure' ? 180000 : 150000,
        operation.abort.signal,
        (data) => {
          operation.view.log = (operation.view.log + data).slice(-16384);
        },
      );
    const pending = (this.workspaces ? this.scopedStart(id, action, input, operation) : execute())
      .then((result) => {
        if (result.code !== 0)
          throw new Error(result.stderr.trim() || `桌面操作失败（退出码 ${result.code}）`);
        if (this.operations.get(id) === operation) this.operations.delete(id);
        this.installed.add(id);
      })
      .catch((error: Error) => {
        if (!operation.abort.signal.aborted) {
          operation.view.status = 'error';
          operation.view.error = redactValues(error.message, operation.privateValues || []);
        }
      });
    this.pending.add(pending);
    operation.done = pending;
    void pending.finally(() => this.pending.delete(pending));
    return { ...operation.view };
  }

  private scopedStart(id: string, action: 'install' | 'start' | 'configure', input: Partial<DesktopPreferences> | undefined,
    operation: Operation) {
    return this.workspaces!.projects.inScope(id, operation.view.projectId!, () => this.machines.locked(id, async () => {
      const signal = operation.abort.signal;
      signal.throwIfAborted();
      const project = await this.workspaces!.resolvedConfig(id), binding = await this.bindings.read(id);
      operation.privateValues = projectPrivateValues(project);
      const phase = await this.servicePhase(id);
      if (phase === 'not-installed' && action === 'configure') throw new AppError('请先安装 KDE 桌面', 409);
      if (['ready', 'starting'].includes(phase) && (binding ?
          binding.projectId !== (project._workspace || 'default') || binding.directory !== project.directory ||
            binding.networkIsolation !== (project.networkIsolation || 'host') :
          (project._workspace || 'default') !== 'default' || project.networkIsolation === 'private'))
        throw new AppError('请先停止实例中已运行的桌面，再绑定此项目', 409);
      this.invalidate(id);
      const captured = await this.bindings.write(id, project, signal);
      Object.assign(operation.view, this.metadata(captured));
      const preferences = input === undefined && action !== 'install' ?
        parseDesktopPreferencesFile((await this.machines.exec(id,
          desktopCommands(this.machines.get(id).distro).preferencesProbe, 10000, signal)).stdout) : operation.view.preferences!;
      const commands = desktopCommands(this.machines.get(id).distro, preferences, project);
      operation.view.preferences = preferences;
      const values = operation.privateValues;
      const log = privateLog((data) => { operation.view.log = (operation.view.log + data).slice(-16384); }, values);
      let result;
      try {
        if (action === 'install' || (await this.machines.exec(id, commands.versionProbe, 10000, signal)).code !== 0) {
          result = await guestTask(this.machines, id, commands.prepare, signal, log.write, 920000);
          if (result.code !== 0) return { ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values) };
        }
        signal.throwIfAborted();
        // Init owns the persistent desktop service. Package preparation has its
        // own cancellable process group and must not inherit that service.
        result = await this.machines.exec(id, action === 'configure' ? commands.configure : commands.startWithPreferences,
          180000, signal, log.write);
      } finally { log.flush(); }
      signal.throwIfAborted();
      if (result.code === 0) {
        if (await this.servicePhase(id) !== 'ready')
          throw new AppError('桌面服务未持续就绪，请查看客户机桌面日志并重试', 409);
        await this.bindingValid(id, captured);
        await this.bindings.enable(id, captured, true);
      }
      return { ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values) };
    }));
  }

  private async desktopCommand(id: string, requestedProject?: string | null, readOnly = false) {
    if (!this.workspaces) return 'exec nc 127.0.0.1 5901';
    const binding = await this.bindings.read(id);
    const requested = readOnly && !requestedProject ? binding?.projectId || 'default' : requestedProject;
    return this.workspaces.projects.with(id, requested, async () => {
      const project = await this.workspaces!.config(id);
      if (binding ? binding.projectId !== (project._workspace || 'default') ||
          binding.directory !== project.directory || binding.networkIsolation !== (project.networkIsolation || 'host') :
        (project._workspace || 'default') !== 'default' || project.networkIsolation === 'private')
        throw new AppError('桌面未绑定当前项目，请停止并重新启动', 409);
      if (!binding) return 'exec nc 127.0.0.1 5901';
      await this.bindingValid(id, binding);
      return `set -eu\n${desktopBindingCheck(binding)}\n` +
        projectNetworkCommand(bindingProject(binding), 'exec nc 127.0.0.1 5901');
    });
  }

  async attach(id: string, socket: WebSocket, readOnly = false, port = 5901,
    appSession?: string, projectId?: string | null) {
    if (!Number.isInteger(port) || port < 5901 || port > 5917 || (!appSession && port !== 5901))
      throw new AppError('无效的桌面端口', 400);
    const abort = new AbortController();
    if (socket.readyState !== WebSocket.OPEN) return;
    const stopWatching = appSession
      ? this.apps.onSessionInvalidated(id, appSession, () => socket.terminate()) : (() => {
        const watchers = this.watchers.get(id) || { startedAt: this.machines.live.get(id)?.startedAt || '', listeners: new Set<() => void>() };
        const listener = () => socket.terminate();
        watchers.listeners.add(listener); this.watchers.set(id, watchers);
        return () => { watchers.listeners.delete(listener); if (!watchers.listeners.size && this.watchers.get(id) === watchers) this.watchers.delete(id); };
      })();
    socket.once('close', () => { abort.abort(); stopWatching?.(); });
    if (this.machines.state(id) !== 'running') throw new AppError('发行版尚未就绪', 409);
    const command = appSession
      ? await this.apps.connectionCommand(id, appSession, port) : await this.desktopCommand(id, projectId, readOnly);
    const ssh = await this.machines.connect(id, 10000, abort.signal);
    const close = () => {
      ssh.destroy();
      socket.close();
    };
    socket.once('close', close);
    ssh.once('close', () => socket.close());
    ssh.on('error', close);
    if (socket.readyState !== WebSocket.OPEN) {
      close();
      return;
    }
    try {
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('桌面连接超时')), 10000);
        // Alpine Tiny Cloud disables TCP forwarding. An exec channel to its
        // built-in netcat carries the same binary stream without changing sshd.
        ssh.exec(command, (error, stream) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(stream);
        });
      });
      if (socket.readyState !== WebSocket.OPEN) {
        channel.destroy();
        close();
        return;
      }
      // Duplex streams enforce backpressure for both graphics and input. The target
      // is fixed to the guest loopback; this endpoint is not an arbitrary TCP proxy.
      const browser = createWebSocketStream(socket);
      browser.on('error', close);
      channel.on('error', close);
      browser.once('close', () => {
        channel.destroy();
        close();
      });
      channel.once('close', () => browser.destroy());
      channel.pipe(browser);
      if (readOnly) {
        const filter = new ReadOnlyRfb();
        filter.on('error', close);
        browser.pipe(filter).pipe(channel);
      } else browser.pipe(channel);
    } catch (error) {
      close();
      throw error;
    }
  }
}
