import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  targets: serviceRef('browser-targets', 'browserTargets', serviceContracts.BrowserTargets),
};
