import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  desktops: serviceRef('desktop', 'desktops', serviceContracts.Desktops),
  jobs: serviceRef('desktop', 'jobs', serviceContracts.Jobs),
  x11Clipboard: serviceRef('desktop', 'x11Clipboard', serviceContracts.X11Clipboard),
  waylandClipboard: serviceRef('desktop', 'waylandClipboard', serviceContracts.WaylandClipboard),
};
