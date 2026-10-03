import { serviceRef } from '../../server/service-ref.ts';
import type { CommandPresets } from '../../server/command-presets.ts';

export const services = {
  commands: serviceRef<CommandPresets>('commands', 'commands'),
};
