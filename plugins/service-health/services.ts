import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  health: serviceRef('service-health', 'health', serviceContracts.ServiceHealth),
};
