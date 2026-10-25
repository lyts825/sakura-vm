import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  accessibility: serviceRef(
    'browser-accessibility',
    'browserAccessibility',
    serviceContracts.BrowserAccessibility,
  ),
};
