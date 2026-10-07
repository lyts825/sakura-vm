/**
 * 模块职责：在通用 Linux 剪贴板服务上选择 Wayland 资源和协议入口，复用统一生命周期。
 * Module purpose: Selects Wayland assets/protocol entry over the shared Linux clipboard service, reusing its lifecycle.
 */
import type { VmAccess as Machines } from './vm-access.ts';
import { X11Clipboard, type X11ApplicationContext, type LinuxClipboardOptions } from './x11-clipboard.ts';

/** The same persisted rule/API semantics with a distinct owned Wayland broker. */
export class WaylandClipboard extends X11Clipboard {
  /**
   * 入口 / Entry: WaylandClipboard.constructor.
   * 功能：建立 WaylandClipboard 的在通用 Linux 剪贴板服务上选择 Wayland 资源和协议入口上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the WaylandClipboard context for this module's responsibility: Selects Wayland assets/protocol entry over the shared Linux clipboard service, reusing its lifecycle. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; applicationProject: (id: string) => Promise<X11ApplicationContext>; options: Omit<LinuxClipboardOptions, 'transport'> default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, applicationProject: (id: string) => Promise<X11ApplicationContext>,
    options: Omit<LinuxClipboardOptions, 'transport'> = {}) {
    super(machines, applicationProject, { ...options, transport: 'wayland' });
  }
}
