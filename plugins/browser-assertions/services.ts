import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  assertions: serviceRef('browser-assertions', 'browserAssertions', serviceContracts.BrowserAssertions),
};
