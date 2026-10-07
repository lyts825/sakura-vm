/**
 * 模块职责：在通用 Linux 剪贴板服务上选择 Wayland 资源和协议入口，复用统一生命周期。
 */
import type { VmAccess as Machines } from './vm-access.ts';
import { X11Clipboard, type X11ApplicationContext, type LinuxClipboardOptions } from './x11-clipboard.ts';

/** The same persisted rule/API semantics with a distinct owned Wayland broker. */
export class WaylandClipboard extends X11Clipboard {
  constructor(machines: Machines, applicationProject: (id: string) => Promise<X11ApplicationContext>,
    options: Omit<LinuxClipboardOptions, 'transport'> = {}) {
    super(machines, applicationProject, { ...options, transport: 'wayland' });
  }
}
