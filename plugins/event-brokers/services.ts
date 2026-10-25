import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  brokers: serviceRef('event-brokers', 'eventBrokers', serviceContracts.EventBrokers),
};
