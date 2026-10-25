import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  exchange: serviceRef('flow-exchange', 'flowExchange', serviceContracts.FlowExchange),
};
