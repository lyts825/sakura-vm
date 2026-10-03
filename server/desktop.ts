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
import { desktopCommands, imeInstall } from './desktop-guest.ts';
import { guestTask } from './guest-task.ts';
import { ReadOnlyRfb } from './readonly-rfb.ts';
import { SingleAppWindows } from './single-app-windows.ts';
import { projectPrivateValues, type Workspaces } from './workspaces.ts';
import { DesktopBindings, desktopServiceStop,
  type DesktopBinding } from './desktop-binding.ts';
import { redactValues } from './secrets.ts';
import { uidCleanupScript } from './single-app-sandbox.ts';
import { X11Clipboard } from './x11-clipboard.ts';
import { WaylandClipboard } from './wayland-clipboard.ts';
import { ProjectDesktops, type DesktopStartPins } from './desktop-project.ts';

type Operation = {
  startedAt: string;
  live?: DesktopStartPins['live'];
  abort: AbortController;
  view: DesktopView;
  privateValues?: string[];
  done?: Promise<void>;
};

export class Desktops {
  readonly apps: SingleAppWindows;
  readonly clipboard: X11Clipboard;
  readonly waylandClipboard: WaylandClipboard;
  private operations = new Map<string, Operation>();
  private pending = new Set<Promise<void>>();
  private closed = false;
  private bindings: DesktopBindings;
  private projectDesktop?: ProjectDesktops;
  private unguard?: () => void;
  private watchers = new Map<string, { startedAt: string; listeners: Set<() => void> }>();
  private recovery = new Map<string, string>();
  private installed = new Set<string>();
  constructor(private machines: Machines, private workspaces?: Workspaces, options?: ConstructorParameters<typeof ProjectDesktops>[2]) {
    this.apps = new SingleAppWindows(machines, workspaces);
    this.bindings = new DesktopBindings(machines);
    this.projectDesktop = workspaces ? new ProjectDesktops(machines, workspaces, { ...options,
      beforeRetire: async (id, proof) => {
        await this.clipboard.retireDesktop(id, proof);
        await this.waylandClipboard.retireDesktop(id, proof);
        await options?.beforeRetire?.(id, proof);
      } }) : undefined;
    const applicationProject = async (id: string) => {
      if (!this.projectDesktop) throw new AppError('请先启用项目工作区', 409);
      return this.projectDesktop.application(id);
    };
    this.clipboard = new X11Clipboard(machines, applicationProject);
    this.waylandClipboard = new WaylandClipboard(machines, applicationProject);
    machines.on('change', this.onChange);
    machines.on('incident-lockdown', this.invalidate);
    this.unguard = workspaces?.beforeConfigChange((id, previous, next) => this.projectDesktop!.beforeChange(id, previous, next));
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
              ...(error instanceof AppError && error.status === 503 ? { cleanupPending: true } : {}),
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
    const restored = await this.projectDesktop!.restore(id);
    if (!restored || this.closed || this.operations.has(id)) return;
    await this.workspaces.projects.with(id, restored.projectId, async () => {
      if (!this.closed && this.machines.state(id) === 'running') this.start(id, 'start', restored.preferences);
    });
  }
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    this.machines.off('incident-lockdown', this.invalidate);
    for (const id of this.watchers.keys()) this.invalidate(id);
    for (const operation of this.operations.values()) operation.abort.abort();
    const results = await Promise.allSettled([this.apps.close(), this.clipboard.close(), this.waylandClipboard.close(), ...this.pending]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason),
      '桌面与应用原运行清理未确认；保留原记录并重试关闭');
    this.operations.clear();
    this.recovery.clear();
    this.unguard?.();
  }

  private async stopService(id: string) {
    this.invalidate(id);
    if (this.projectDesktop) return this.projectDesktop.stop(id);
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

  async view(id: string, bound = false): Promise<DesktopView> {
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { status: 'unavailable', log: '', preferences: defaultDesktopPreferences };
    const operation = this.operations.get(id);
    if (operation) return { ...operation.view, ...(this.workspaces && !bound ? {
      bindingMismatch: operation.view.projectId !== this.workspaces.projects.current(id) } : {}) };
    if (this.projectDesktop) return this.projectDesktop.view(id, bound);
    const binding: DesktopBinding | null = null;
    const commands = desktopCommands(vm.distro, defaultDesktopPreferences);
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
    return { status: status as DesktopView['status'], log: '', preferences };
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
    const capturedInput = input === undefined ? undefined : structuredClone(input);
    const preferences = desktopPreferencesSchema.parse(capturedInput || {});
    const commands = desktopCommands(vm.distro, preferences);
    const status = action === 'install' ? 'installing' : 'starting';
    const operation: Operation = {
      startedAt: live.startedAt,
      live,
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
    const pending = (this.workspaces ? this.scopedStart(id, action, capturedInput, operation) : execute())
      .then((result) => {
        if (result.code !== 0)
          throw new Error(result.stderr.trim() || `桌面操作失败（退出码 ${result.code}）`);
        if (this.operations.get(id) === operation) this.operations.delete(id);
        this.installed.add(id);
      })
      .catch((error: Error) => {
        if (!operation.abort.signal.aborted || error instanceof AppError && error.status === 503) {
          operation.view.status = 'error';
          operation.view.error = redactValues(error.message, operation.privateValues || []);
          operation.view.cleanupPending = error instanceof AppError && error.status === 503;
        }
      });
    this.pending.add(pending);
    operation.done = pending;
    void pending.finally(() => this.pending.delete(pending));
    return { ...operation.view };
  }

  private scopedStart(id: string, action: 'install' | 'start' | 'configure', input: Partial<DesktopPreferences> | undefined,
    operation: Operation) {
    return this.projectDesktop!.start(id, action, input, { projectId: operation.view.projectId!, live: operation.live! },
      operation.abort.signal, (data) => { operation.view.log = (operation.view.log + data).slice(-16384); },
      (binding, values) => {
        operation.privateValues = values;
        Object.assign(operation.view, { projectId: binding.projectId, directory: binding.directory,
          networkIsolation: binding.networkIsolation, preferences: binding.preferences });
      });
  }

  async installIme(id: string, signal: AbortSignal, log: (line: string) => void) {
    const live = this.machines.live.get(id), projectId = this.workspaces?.projects.current(id);
    const vm = this.machines.get(id);
    signal.throwIfAborted();
    if (this.closed || this.machines.closing || live?.status !== 'running')
      throw new AppError('请先恢复或启动实例，再安装输入法', 409);
    const previous = this.operations.get(id);
    if (previous && ['installing', 'starting'].includes(previous.view.status))
      throw new AppError('桌面操作正在进行，请等待原操作完成', 409);
    const operation: Operation = { startedAt: live.startedAt, live, abort: new AbortController(),
      view: { status: 'installing', log: '', preferences: defaultDesktopPreferences, ...(projectId ? { projectId } : {}) } };
    this.operations.set(id, operation);
    const abort = () => operation.abort.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const output = (line: string) => {
      const value = redactValues(line, operation.privateValues || []);
      operation.view.log = (operation.view.log + value).slice(-16384); log(value);
    };
    const running = (this.projectDesktop
      ? this.projectDesktop.start(id, 'ime', undefined, { projectId: projectId!, live }, operation.abort.signal, output,
        (binding, values) => {
          operation.privateValues = values;
          Object.assign(operation.view, { projectId: binding.projectId, directory: binding.directory,
            networkIsolation: binding.networkIsolation, preferences: binding.preferences });
        })
      : guestTask(this.machines, id, imeInstall(vm.distro), operation.abort.signal, output))
      .then(result => {
        if (result.code !== 0) throw new AppError(result.stderr.trim() || '输入法安装失败（退出码 ' + result.code + '）', 409);
        if (this.operations.get(id) === operation) this.operations.delete(id);
        this.installed.add(id);
        return result;
      }).catch((error: Error) => {
        if (!operation.abort.signal.aborted || error instanceof AppError && error.status === 503) {
          operation.view.status = 'error'; operation.view.error = redactValues(error.message, operation.privateValues || []);
          operation.view.cleanupPending = error instanceof AppError && error.status === 503;
        }
        throw error;
      }).finally(() => signal.removeEventListener('abort', abort));
    const completion = running.then(() => {}, () => {});
    operation.done = completion; this.pending.add(completion);
    void completion.finally(() => this.pending.delete(completion));
    return running;
  }

  private async desktopCommand(id: string, requestedProject?: string | null, readOnly = false) {
    if (!this.projectDesktop) return 'exec nc 127.0.0.1 5901';
    return this.projectDesktop.command(id, requestedProject, readOnly);
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
