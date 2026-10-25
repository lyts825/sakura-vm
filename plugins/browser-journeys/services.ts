import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  journeys: serviceRef('browser-journeys', 'browserJourneys', serviceContracts.BrowserJourneys),
};
