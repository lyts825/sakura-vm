import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  runtimes: serviceRef('runtimes', 'runtimes', serviceContracts.RuntimeVersions),
};
