import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  contracts: serviceRef('event-contracts', 'eventContracts', serviceContracts.EventContracts),
};
