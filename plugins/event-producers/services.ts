import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  producers: serviceRef('event-producers', 'eventProducers', serviceContracts.EventProducers),
};
