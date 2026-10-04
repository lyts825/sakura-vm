import { serviceRef } from '../../server/service-ref.ts';
import type { TerminalService } from '../../server/terminal-backend.ts';

export const services = {
  terminals: serviceRef<TerminalService>('terminal-workspace', 'terminals'),
};
