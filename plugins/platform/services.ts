import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  next: serviceRef('platform', 'next', serviceContracts.NextFeatures),
};
