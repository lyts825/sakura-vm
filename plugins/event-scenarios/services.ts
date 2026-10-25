import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  scenarios: serviceRef('event-scenarios', 'eventScenarios', serviceContracts.EventScenarios),
};
