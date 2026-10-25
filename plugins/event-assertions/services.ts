import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  assertions: serviceRef('event-assertions', 'eventAssertions', serviceContracts.EventAssertions),
};
