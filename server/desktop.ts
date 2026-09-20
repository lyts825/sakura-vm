import { createWebSocketStream, WebSocket } from 'ws';
import type { ClientChannel } from 'ssh2';
import type { Machines } from './machines.ts';
import { AppError, type DesktopView } from './model.ts';
import { desktopCommands } from './desktop-guest.ts';

type Operation = {
  startedAt: string;
  abort: AbortController;
  view: DesktopView;
};

export class Desktops {
  private operations = new Map<string, Operation>();
  constructor(private machines: Machines) {
    machines.on('change', () => {
      for (const [id, operation] of this.operations) {
        const live = machines.live.get(id);
        if (live?.status !== 'running' || live.startedAt !== operation.startedAt) {
          operation.abort.abort();
          this.operations.delete(id);
        }
      }
    });
  }

  async view(id: string): Promise<DesktopView> {
    this.machines.get(id);
    if (this.machines.state(id) !== 'running') return { status: 'unavailable', log: '' };
    const operation = this.operations.get(id);
    if (operation) return { ...operation.view };
    const result = await this.machines.exec(id, desktopCommands(this.machines.get(id).distro).probe, 10000);
    const status = result.stdout.trim();
    if (result.code !== 0 || !['not-installed', 'starting', 'ready', 'stopped'].includes(status))
      throw new AppError('无法检查桌面状态，请重试', 502);
    return { status: status as DesktopView['status'], log: '' };
  }

  start(id: string, action: 'install' | 'start'): DesktopView {
    const vm = this.machines.get(id);
    const live = this.machines.live.get(id);
    if (this.machines.closing || live?.status !== 'running')
      throw new AppError('请等待发行版启动完成，再启用桌面', 409);
    const previous = this.operations.get(id);
    if (previous?.view.status === 'installing') return { ...previous.view };
    if (vm.memoryMiB < 1024)
      throw new AppError('图形桌面至少需要 1024 MiB 内存；请停机后在「配置」中调整，建议 2048 MiB', 409);
    const operation: Operation = {
      startedAt: live.startedAt,
      abort: new AbortController(),
      view: { status: 'installing', log: action === 'install' ? '正在准备桌面安装…\n' : '正在启动桌面…\n' },
    };
    this.operations.set(id, operation);
    void this.machines
      .exec(
        id,
        action === 'install' ? desktopCommands(vm.distro).install : desktopCommands(vm.distro).start,
        action === 'install' ? 920000 : 150000,
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
    return { ...operation.view };
  }

  async attach(id: string, socket: WebSocket) {
    const abort = new AbortController();
    socket.once('close', () => abort.abort());
    if (socket.readyState !== WebSocket.OPEN) return;
    if (this.machines.state(id) !== 'running') throw new AppError('发行版尚未就绪', 409);
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
        ssh.exec('exec nc 127.0.0.1 5901', (error, stream) => {
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
      channel.pipe(browser).pipe(channel);
    } catch (error) {
      close();
      throw error;
    }
  }
}
