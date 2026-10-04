import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  terminals: serviceRef('terminal-workspace', 'terminals', serviceContracts.ProjectTerminals),
};
