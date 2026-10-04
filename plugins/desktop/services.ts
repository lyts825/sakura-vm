import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Desktops } from '../../server/desktop.ts';
import type { Jobs } from '../../server/jobs.ts';
import type { X11Clipboard } from '../../server/x11-clipboard.ts';
import type { WaylandClipboard } from '../../server/wayland-clipboard.ts';

export const services = {
  desktops: serviceRef<ServiceInterface<Desktops>>('desktop', 'desktops'),
  jobs: serviceRef<Jobs>('desktop', 'jobs'),
  x11Clipboard: serviceRef<ServiceInterface<X11Clipboard>>('desktop', 'x11Clipboard'),
  waylandClipboard: serviceRef<ServiceInterface<WaylandClipboard>>('desktop', 'waylandClipboard'),
};
