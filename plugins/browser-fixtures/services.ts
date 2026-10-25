import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  fixtures: serviceRef('browser-fixtures', 'browserFixtures', serviceContracts.BrowserFixtures),
};
