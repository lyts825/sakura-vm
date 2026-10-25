import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  exchange: serviceRef('media-exchange', 'mediaExchange', serviceContracts.MediaExchange),
};
