import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  commands: serviceRef('commands', 'commands', serviceContracts.CommandPresets),
};
