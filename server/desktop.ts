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
import type { Workspaces } from './workspaces.ts';

type Operation = {
  startedAt: string;
  abort: AbortController;
  view: DesktopView;
};

export class Desktops {
  readonly apps: SingleAppWindows;
  private operations = new Map<string, Operation>();
  private pending = new Set<Promise<void>>();
  private closed = false;
  constructor(private machines: Machines, workspaces?: Workspaces) {
    this.apps = new SingleAppWindows(machines, workspaces);
    machines.on('change', this.onChange);
  }
  private onChange = () => {
    for (const [id, operation] of this.operations) {
      const live = this.machines.live.get(id);
      if (live?.status !== 'running' || live.startedAt !== operation.startedAt) {
        operation.abort.abort();
        this.operations.delete(id);
      }
    }
  };
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    await this.apps.close();
    for (const operation of this.operations.values()) operation.abort.abort();
    await Promise.allSettled([...this.pending]);
    this.operations.clear();
  }

  async view(id: string): Promise<DesktopView> {
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { status: 'unavailable', log: '', preferences: defaultDesktopPreferences };
    const operation = this.operations.get(id);
    if (operation) return { ...operation.view };
    const commands = desktopCommands(vm.distro);
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
    if (previous && ['installing', 'starting'].includes(previous.view.status)) return { ...previous.view };
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
        log:
          action === 'install'
            ? '正在准备 KDE Plasma 桌面安装…\n'
            : action === 'configure'
              ? '正在应用 KDE Plasma 外观配置…\n'
              : '正在启动 KDE Plasma 桌面…\n',
      },
    };
    this.operations.set(id, operation);
    const pending = this.machines
      .exec(
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
      )
      .then((result) => {
        if (result.code !== 0)
          throw new Error(result.stderr.trim() || `桌面操作失败（退出码 ${result.code}）`);
        if (this.operations.get(id) === operation) this.operations.delete(id);
      })
      .catch((error: Error) => {
        if (!operation.abort.signal.aborted) {
          operation.view.status = 'error';
          operation.view.error = error.message;
        }
      });
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending));
    return { ...operation.view };
  }

  async attach(id: string, socket: WebSocket, readOnly = false, port = 5901,
    appSession?: string) {
    if (!Number.isInteger(port) || port < 5901 || port > 5917)
      throw new AppError('无效的桌面端口', 400);
    const abort = new AbortController();
    if (socket.readyState !== WebSocket.OPEN) return;
    const stopWatching = appSession
      ? this.apps.onSessionInvalidated(id, appSession, () => socket.terminate()) : null;
    socket.once('close', () => { abort.abort(); stopWatching?.(); });
    if (this.machines.state(id) !== 'running') throw new AppError('发行版尚未就绪', 409);
    const command = appSession
      ? await this.apps.connectionCommand(id, appSession, port) : `exec nc 127.0.0.1 ${port}`;
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
