import type { Machines } from './machines.ts';
import { X11Clipboard, type X11ApplicationContext, type LinuxClipboardOptions } from './x11-clipboard.ts';

/** The same persisted rule/API semantics with a distinct owned Wayland broker. */
export class WaylandClipboard extends X11Clipboard {
  constructor(machines: Machines, applicationProject: (id: string) => Promise<X11ApplicationContext>,
    options: Omit<LinuxClipboardOptions, 'transport'> = {}) {
    super(machines, applicationProject, { ...options, transport: 'wayland' });
  }
}
