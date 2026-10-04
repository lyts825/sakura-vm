import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { CommandPresets } from '../../server/command-presets.ts';

export const services = {
  commands: serviceRef<ServiceInterface<CommandPresets>>('commands', 'commands'),
};
